.PHONY: install
install:
	pip install -r requirements-dev.txt

.PHONY: dev run
dev:
	uvicorn src.main:app --reload --port 8000

run: dev

.PHONY: test
test:
	SUPABASE_URL="https://mock.supabase.co" SUPABASE_SERVICE_ROLE_KEY="mock-key" python -m unittest discover -s tests

.PHONY: lint
lint:
	ruff check .

.PHONY: format
format:
	ruff format .

.PHONY: check
check:
	mypy src/

.PHONY: lint-all
lint-all:
	make lint
	make format
	make check
	make test

.PHONY: models
models:
	datamodel-codegen --input ../../packages/contracts/schemas/contracts.schema.json --input-file-type jsonschema --output src/contracts/generated.py --output-model-type pydantic_v2.BaseModel --disable-timestamp --use-double-quotes --formatters builtin
