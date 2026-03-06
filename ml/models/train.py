"""
Train teacher (LoRA) then student (distillation) for CodeLens reranker.
Uses Hydra for config, W&B for experiment tracking.

Usage:
    python -m ml.models.train
    python -m ml.models.train training.batch_size=16
"""
from __future__ import annotations

import json
import os
import random
from pathlib import Path

import structlog

import hydra
import numpy as np
from omegaconf import DictConfig, OmegaConf

logger = structlog.get_logger()


def set_seeds(seed: int) -> None:
    """Set all random seeds for reproducibility.

    Args:
        seed: Integer seed applied to Python ``random``, NumPy, and PyTorch
            (including CUDA if available).
    """
    random.seed(seed)
    np.random.seed(seed)
    try:
        import torch
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
    except ImportError:
        pass


def load_pairs(path: str) -> tuple[list[str], list[int]]:
    """Load training pairs from ``reranker_pairs.jsonl``.

    If the file is missing, it is auto-generated from ``pr_files.jsonl`` by
    calling :func:`ml.data.build_reranker_pairs.build_pairs`.

    Args:
        path: Path to ``pr_files.jsonl`` (used to derive the pairs file location
            and as input for auto-generation).

    Returns:
        ``(texts, labels)`` where ``texts`` is a list of input strings and
        ``labels`` is a list of binary int labels (1 = important, 0 = not).
    """
    p = Path(path)
    pairs_path = p.parent / "reranker_pairs.jsonl"

    if not pairs_path.exists():
        logger.info("reranker_pairs.jsonl not found — building from pr_files.jsonl")
        from ml.data.build_reranker_pairs import build_pairs
        build_pairs(input_path=p, output_path=pairs_path)

    texts, labels = [], []
    with open(pairs_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            texts.append(rec["text"])
            labels.append(rec["label"])

    logger.info("loaded training pairs", total=len(texts), positive=sum(labels), negative=len(labels) - sum(labels))
    return texts, labels


def make_dataset(texts: list[str], labels: list[int], tokenizer, max_length: int):
    """Create a PyTorch ``Dataset`` from tokenized texts and binary labels.

    Args:
        texts: Raw input strings to tokenize.
        labels: Binary int labels (0 or 1) parallel to ``texts``.
        tokenizer: Hugging Face tokenizer.
        max_length: Maximum token sequence length (truncation + padding).

    Returns:
        A ``torch.utils.data.Dataset`` whose items are dicts with keys
        ``input_ids``, ``attention_mask``, ``token_type_ids``, and ``labels``.
    """
    import torch
    from torch.utils.data import Dataset

    class PairDataset(Dataset):
        def __init__(self, texts, labels, tokenizer, max_length):
            enc = tokenizer(
                texts,
                padding=True,
                truncation=True,
                max_length=max_length,
                return_tensors="pt",
            )
            self.input_ids = enc["input_ids"]
            self.attention_mask = enc["attention_mask"]
            self.token_type_ids = enc.get("token_type_ids",
                                          torch.zeros_like(enc["input_ids"]))
            self.labels = torch.tensor(labels, dtype=torch.float32)

        def __len__(self):
            return len(self.labels)

        def __getitem__(self, idx):
            return {
                "input_ids": self.input_ids[idx],
                "attention_mask": self.attention_mask[idx],
                "token_type_ids": self.token_type_ids[idx],
                "labels": self.labels[idx],
            }

    return PairDataset(texts, labels, tokenizer, max_length)


def train_teacher(cfg: DictConfig, texts: list[str], labels: list[int], wandb_run) -> tuple:
    """Train the teacher model (CodeBERT + LoRA) with BCEWithLogitsLoss.

    Uses a linear LR schedule with 10 % warmup, gradient clipping at 1.0, and
    patience-2 early stopping on validation loss.

    Args:
        cfg: Hydra config with ``model``, ``training``, and ``data`` sections.
        texts: Training pair texts.
        labels: Binary training labels.
        wandb_run: Active W&B run (or ``None`` to skip logging).

    Returns:
        ``(model, tokenizer)`` tuple — model is still PEFT-wrapped.
    """
    import torch
    from torch.utils.data import DataLoader
    from transformers import (
        AutoModelForSequenceClassification,
        AutoTokenizer,
        get_linear_schedule_with_warmup,
    )
    from peft import get_peft_model, LoraConfig, TaskType
    from sklearn.metrics import roc_auc_score

    logger.info("training teacher", model=cfg.model.teacher_base)

    tokenizer = AutoTokenizer.from_pretrained(
        cfg.model.teacher_base, cache_dir="/tmp/hf-cache"
    )
    base_model = AutoModelForSequenceClassification.from_pretrained(
        cfg.model.teacher_base, num_labels=1, cache_dir="/tmp/hf-cache"
    )

    lora_cfg = LoraConfig(
        task_type=TaskType.SEQ_CLS,
        r=cfg.model.lora_r,
        lora_alpha=cfg.model.lora_alpha,
        lora_dropout=cfg.model.lora_dropout,
        target_modules=list(cfg.model.target_modules),
    )
    model = get_peft_model(base_model, lora_cfg)
    model.print_trainable_parameters()

    # Split 90/10
    n = len(texts)
    split = int(0.9 * n)
    train_ds = make_dataset(texts[:split], labels[:split], tokenizer, cfg.data.max_length)
    val_ds = make_dataset(texts[split:], labels[split:], tokenizer, cfg.data.max_length)

    train_loader = DataLoader(train_ds, batch_size=cfg.training.batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=cfg.training.batch_size)

    optimizer = torch.optim.AdamW(model.parameters(), lr=cfg.training.teacher_lr)
    criterion = torch.nn.BCEWithLogitsLoss()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)

    total_steps = len(train_loader) * cfg.training.teacher_epochs
    warmup_steps = max(1, int(0.1 * total_steps))
    scheduler = get_linear_schedule_with_warmup(
        optimizer, num_warmup_steps=warmup_steps, num_training_steps=total_steps
    )

    best_val_loss = float("inf")
    patience_counter = 0
    global_step = 0
    for epoch in range(cfg.training.teacher_epochs):
        model.train()
        epoch_loss = 0.0
        for batch in train_loader:
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            token_type_ids = batch["token_type_ids"].to(device)
            batch_labels = batch["labels"].to(device)

            optimizer.zero_grad()
            outputs = model(
                input_ids=input_ids,
                attention_mask=attention_mask,
                token_type_ids=token_type_ids,
            )
            logits = outputs.logits.squeeze(-1)
            loss = criterion(logits, batch_labels)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()

            epoch_loss += loss.item()
            global_step += 1
            if wandb_run:
                wandb_run.log({"teacher/train_loss": loss.item(), "step": global_step})

        # Validation
        model.eval()
        val_loss = 0.0
        all_logits, all_labels = [], []
        with torch.no_grad():
            for batch in val_loader:
                input_ids = batch["input_ids"].to(device)
                attention_mask = batch["attention_mask"].to(device)
                token_type_ids = batch["token_type_ids"].to(device)
                batch_labels = batch["labels"].to(device)
                outputs = model(
                    input_ids=input_ids,
                    attention_mask=attention_mask,
                    token_type_ids=token_type_ids,
                )
                logits = outputs.logits.squeeze(-1)
                loss = criterion(logits, batch_labels)
                val_loss += loss.item()
                all_logits.extend(logits.cpu().tolist())
                all_labels.extend(batch_labels.cpu().tolist())

        avg_val_loss = val_loss / max(len(val_loader), 1)
        try:
            auc = roc_auc_score(all_labels, all_logits) if len(set(all_labels)) > 1 else 0.0
        except Exception:
            auc = 0.0

        logger.info("teacher epoch", epoch=epoch + 1, total=cfg.training.teacher_epochs, val_loss=round(avg_val_loss, 4), auc=round(auc, 4))
        if wandb_run:
            wandb_run.log({
                "teacher/val_loss": avg_val_loss,
                "teacher/auc": auc,
                "epoch": epoch + 1,
            })

        # Early stopping (patience = 2)
        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            patience_counter = 0
        else:
            patience_counter += 1
            if patience_counter >= 2:
                logger.info("teacher early stopping", epoch=epoch + 1)
                break

    return model, tokenizer


def train_student(
    cfg: DictConfig,
    teacher_model,
    teacher_tokenizer,
    texts: list[str],
    labels: list[int],
    wandb_run,
) -> tuple:
    """Train the student model via knowledge distillation from the teacher.

    Uses combined hard-label BCE and soft-label distillation loss:
    ``(1 - α) * hard + α * soft``.  Applies LR warmup (10 %), gradient
    clipping (1.0), and patience-2 early stopping.

    Args:
        cfg: Hydra config with ``model``, ``training``, and ``distillation`` sections.
        teacher_model: Trained teacher (PEFT-wrapped CodeBERT + LoRA).
        teacher_tokenizer: Teacher tokenizer.
        texts: Training pair texts.
        labels: Binary training labels.
        wandb_run: Active W&B run (or ``None``).

    Returns:
        ``(student_model, student_tokenizer)`` tuple.
    """
    import torch
    import torch.nn.functional as F
    from torch.utils.data import DataLoader
    from transformers import (
        AutoModelForSequenceClassification,
        AutoTokenizer,
        get_linear_schedule_with_warmup,
    )
    from sklearn.metrics import roc_auc_score

    logger.info("training student", model=cfg.model.student_base)

    student_tokenizer = AutoTokenizer.from_pretrained(
        cfg.model.student_base, cache_dir="/tmp/hf-cache"
    )
    student_model = AutoModelForSequenceClassification.from_pretrained(
        cfg.model.student_base, num_labels=1, cache_dir="/tmp/hf-cache"
    )

    n = len(texts)
    split = int(0.9 * n)
    train_ds = make_dataset(texts[:split], labels[:split], student_tokenizer, cfg.data.max_length)
    val_ds = make_dataset(texts[split:], labels[split:], student_tokenizer, cfg.data.max_length)
    teacher_train_ds = make_dataset(texts[:split], labels[:split], teacher_tokenizer, cfg.data.max_length)

    train_loader = DataLoader(train_ds, batch_size=cfg.training.batch_size, shuffle=False)
    teacher_train_loader = DataLoader(teacher_train_ds, batch_size=cfg.training.batch_size, shuffle=False)
    val_loader = DataLoader(val_ds, batch_size=cfg.training.batch_size)

    optimizer = torch.optim.AdamW(student_model.parameters(), lr=cfg.training.student_lr)
    ce_loss = torch.nn.BCEWithLogitsLoss()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    student_model.to(device)
    teacher_model.to(device)
    teacher_model.eval()

    alpha = cfg.distillation.alpha
    T = cfg.distillation.temperature

    total_steps = len(train_loader) * cfg.training.student_epochs
    warmup_steps = max(1, int(0.1 * total_steps))
    scheduler = get_linear_schedule_with_warmup(
        optimizer, num_warmup_steps=warmup_steps, num_training_steps=total_steps
    )

    best_val_loss = float("inf")
    patience_counter = 0
    global_step = 0
    for epoch in range(cfg.training.student_epochs):
        student_model.train()
        epoch_loss = 0.0

        for student_batch, teacher_batch in zip(train_loader, teacher_train_loader):
            # Student forward
            s_input_ids = student_batch["input_ids"].to(device)
            s_attention_mask = student_batch["attention_mask"].to(device)
            s_token_type_ids = student_batch["token_type_ids"].to(device)
            hard_labels = student_batch["labels"].to(device)

            # Teacher soft labels (no grad)
            with torch.no_grad():
                t_out = teacher_model(
                    input_ids=teacher_batch["input_ids"].to(device),
                    attention_mask=teacher_batch["attention_mask"].to(device),
                    token_type_ids=teacher_batch["token_type_ids"].to(device),
                )
                soft_labels = torch.sigmoid(t_out.logits.squeeze(-1) / T)

            optimizer.zero_grad()
            s_out = student_model(
                input_ids=s_input_ids,
                attention_mask=s_attention_mask,
                token_type_ids=s_token_type_ids,
            )
            s_logits = s_out.logits.squeeze(-1)

            # Combined distillation loss
            loss_hard = ce_loss(s_logits, hard_labels)
            loss_soft = ce_loss(s_logits / T, soft_labels)
            loss = (1 - alpha) * loss_hard + alpha * loss_soft

            loss.backward()
            torch.nn.utils.clip_grad_norm_(student_model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()

            epoch_loss += loss.item()
            global_step += 1
            if wandb_run:
                wandb_run.log({
                    "student/train_loss": loss.item(),
                    "student/hard_loss": loss_hard.item(),
                    "student/soft_loss": loss_soft.item(),
                    "step": global_step,
                })

        # Validation
        student_model.eval()
        val_loss = 0.0
        all_logits, all_labels_list = [], []
        with torch.no_grad():
            for batch in val_loader:
                input_ids = batch["input_ids"].to(device)
                attention_mask = batch["attention_mask"].to(device)
                token_type_ids = batch["token_type_ids"].to(device)
                batch_labels = batch["labels"].to(device)
                out = student_model(
                    input_ids=input_ids,
                    attention_mask=attention_mask,
                    token_type_ids=token_type_ids,
                )
                logits = out.logits.squeeze(-1)
                loss = ce_loss(logits, batch_labels)
                val_loss += loss.item()
                all_logits.extend(logits.cpu().tolist())
                all_labels_list.extend(batch_labels.cpu().tolist())

        avg_val_loss = val_loss / max(len(val_loader), 1)
        try:
            auc = roc_auc_score(all_labels_list, all_logits) if len(set(all_labels_list)) > 1 else 0.0
        except Exception:
            auc = 0.0

        logger.info("student epoch", epoch=epoch + 1, total=cfg.training.student_epochs, val_loss=round(avg_val_loss, 4), auc=round(auc, 4))
        if wandb_run:
            wandb_run.log({
                "student/val_loss": avg_val_loss,
                "student/auc": auc,
                "epoch": epoch + 1,
            })

        # Early stopping (patience = 2)
        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            patience_counter = 0
        else:
            patience_counter += 1
            if patience_counter >= 2:
                logger.info("student early stopping", epoch=epoch + 1)
                break

    return student_model, student_tokenizer


def save_checkpoint(model, tokenizer, output_dir: Path) -> None:
    """Save a model and tokenizer checkpoint, merging LoRA weights if present.

    Args:
        model: A Hugging Face model (optionally PEFT-wrapped).
        tokenizer: Corresponding tokenizer.
        output_dir: Directory to write checkpoint files.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    # Unwrap PEFT if needed
    try:
        model = model.merge_and_unload()
    except AttributeError:
        pass
    model.save_pretrained(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))
    logger.info("checkpoint saved", path=str(output_dir))


@hydra.main(config_path="../config", config_name="train", version_base=None)
def main(cfg: DictConfig) -> None:
    logger.info("config loaded", config=OmegaConf.to_yaml(cfg))

    set_seeds(cfg.training.seed)

    # W&B init
    wandb_run = None
    try:
        import wandb
        wandb_run = wandb.init(
            project="codelens-reranker",
            config=OmegaConf.to_container(cfg, resolve=True),
        )
        logger.info("wandb run started", url=wandb_run.url)
    except Exception as e:
        logger.warning("wandb not available, training without logging", error=str(e))

    # Load data
    texts, labels = load_pairs(cfg.data.train_path)

    # Train teacher
    teacher_model, teacher_tokenizer = train_teacher(cfg, texts, labels, wandb_run)

    # Save teacher checkpoint
    teacher_dir = Path("ml/models/reranker_teacher")

    # Save LoRA adapter weights separately (~3 MB, before merge)
    lora_adapter_dir = teacher_dir / "lora_adapter"
    lora_adapter_dir.mkdir(parents=True, exist_ok=True)
    try:
        teacher_model.save_pretrained(str(lora_adapter_dir))
        teacher_tokenizer.save_pretrained(str(lora_adapter_dir))
        logger.info("lora adapter saved", path=str(lora_adapter_dir))
    except Exception as e:
        logger.warning("could not save lora adapter separately", error=str(e))

    save_checkpoint(teacher_model, teacher_tokenizer, teacher_dir)

    # Train student with distillation
    student_model, student_tokenizer = train_student(
        cfg, teacher_model, teacher_tokenizer, texts, labels, wandb_run
    )

    # Save student checkpoint (this is the production model)
    student_dir = Path("ml/models/reranker")
    save_checkpoint(student_model, student_tokenizer, student_dir)

    if wandb_run:
        wandb_run.finish()

    logger.info("training complete", student_checkpoint=str(student_dir))


if __name__ == "__main__":
    main()
