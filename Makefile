.PHONY: artifact

artifact:
	docker compose build dev
	docker compose run --rm dev
	@echo "成果物: dist/"
