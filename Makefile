.PHONY: setup setup-ml setup-web ml-api web eval benchmark train \
        build lint test dev

# ── Install ───────────────────────────────────────────────────────────────────

setup: setup-web setup-ml

setup-ml:
	pip install -e ".[ml]" --break-system-packages
	python -m ml.data.scraper
	python -m ml.data.build_dataset
	python -m ml.models.build_index

setup-web:
	cd apps/web && npm install

# ── Run ───────────────────────────────────────────────────────────────────────

ml-api:
	pip install -r apps/api-hf/requirements.txt --break-system-packages
	cd apps/api-hf && uvicorn main:app --reload --port 8000

web:
	cd apps/web && npm run dev

dev:
	turbo dev

# ── Build ─────────────────────────────────────────────────────────────────────

build:
	cd apps/web && npm run build

# ── ML ────────────────────────────────────────────────────────────────────────

eval:
	python -m ml.eval.run_eval

benchmark:
	python -m ml.eval.benchmark

train:
	python -m ml.models.train

# ── Test / Lint ───────────────────────────────────────────────────────────────

test:
	pytest ml/eval/ -v

lint:
	cd apps/web && npm run lint
	ruff check ml/ apps/api-hf/

solid:
	cd apps/web-solid && npm run dev

build-solid:
	cd apps/web-solid && npm run build

test-solid:
	cd apps/web-solid && npm test

deploy-solid:
	cd apps/web-solid && npx vercel --prod
