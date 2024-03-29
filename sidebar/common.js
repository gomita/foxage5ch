////////////////////////////////////////////////////////////////////////////////
// background

function getService() {
	if ("sidebarAction" in browser) {
		document.documentElement.setAttribute("browser", "Firefox");
		// [Firefox]
		return browser.runtime.getBackgroundPage().then(win => {
			window.FoxAgeSvc = win.FoxAgeSvc;
			window.FoxAgeUtils = win.FoxAgeUtils;
			document.documentElement.setAttribute("theme", win.FoxAgeSvc.getPref("theme"));
		});
	}
	else {
		// [Chrome]
		let win = chrome.extension.getBackgroundPage();
		window.FoxAgeSvc = win.FoxAgeSvc;
		window.FoxAgeUtils = win.FoxAgeUtils;
		document.documentElement.setAttribute("browser", "Chrome");
		document.documentElement.setAttribute("theme", win.FoxAgeSvc.getPref("theme"));
	}
}

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
	document.addEventListener("keydown", event => {
		if (event.key == "Escape") {
			event.preventDefault();
			window.top.hideLayer();
		}
	});
}

function disableContextMenu() {
	document.addEventListener("contextmenu", event => {
		if (event.target.localName == "input" && 
		    event.target.getAttribute("type") == "text")
			return;
		event.preventDefault();
		event.stopPropagation();
	});
}

