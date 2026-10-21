.PHONY: install
install:
	pip install -r requirements-dev.txt

.PHONY: run
run:
	uvicorn src.main:app --reload --port 8000

.PHONY: test
test:
	python -m unittest discover -s tests

.PHONY: lint
lint:
	ruff check .

.PHONY: format
format:
	ruff format .

.PHONY: check
check:
	mypy src/

.PHONY: models
models:
	datamodel-codegen --input ../../packages/contracts/schemas/contracts.schema.json --input-file-type jsonschema --output src/contracts/generated.py --output-model-type pydantic_v2.BaseModel --formatters builtin
