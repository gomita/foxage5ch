////////////////////////////////////////////////////////////////////////////////
// background

var FoxAgeSvc;
var FoxAgeUtils;

browser.runtime.getBackgroundPage(win => {
	FoxAgeSvc = win.FoxAgeSvc;
	FoxAgeUtils = win.FoxAgeUtils;
});

////////////////////////////////////////////////////////////////////////////////
// global

function localize() {
	var elts = document.querySelectorAll("[i18n]");
	for (let elt of elts) {
		elt.getAttribute("i18n").split(",").forEach(val => {
			let [attr, msg] = val.split(":");
			if (attr == "text")
				elt.textContent = browser.i18n.getMessage(msg);
			else
				elt.setAttribute(attr, browser.i18n.getMessage(msg));
			elt.removeAttribute("i18n");
		});
	}
}

// iframe要素の高さをフィットさせる
function fitToContent() {
	var iframe = window.top.document.querySelector("iframe");
	iframe.height = document.body.clientHeight + 10;
}

function captureKeyEvents() {
	document.addEventListener("keypress", event => {
		if (event.keyCode == event.DOM_VK_ESCAPE)
			window.top.hideLayer();
	});
}

function disableContextMenu() {
	document.addEventListener("contextmenu", event => {
		event.preventDefault();
		event.stopPropagation();
	});
}

