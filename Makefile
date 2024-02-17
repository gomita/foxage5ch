EXT_NAME = foxage5ch
INC_FILES = manifest.json LICENSE.txt _locales background defaults icons lib sidebar

.PHONY: xpi
xpi:
	rm -f $(EXT_NAME).xpi
	zip -r -9 $(EXT_NAME).xpi $(INC_FILES)
