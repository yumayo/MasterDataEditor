.PHONY: artifact

artifact:
	docker compose run --rm dev
	$(eval VERSION := $(shell date +%Y%m%d%H%M)-$(shell git rev-parse --short=8 HEAD))
	(cd dist && zip -r ../App.MasterDataEditor_$(VERSION).zip .)
	@echo "成果物: App.MasterDataEditor_$(VERSION).zip"
