////////////////////////////////////////////////////////////////////////////////
// global

async function init() {
	await getService();
	localize();
	captureKeyEvents();
	disableContextMenu();
	document.getElementById("backButton").onclick = window.top.hideLayer;
	document.getElementById("cancelButton").onclick = window.top.hideLayer;
	document.getElementById("execButton").onclick = addURL;
	document.getElementById("addTabButton").onclick = addTab;
	document.addEventListener("keypress", onKeyPress);
	// タブで開いている場合、現在のタブを追加するボタンを非活性にする
	if (window.top.location.hash == "#tab") {
		document.getElementById("addTabButton").disabled = true;
	}
	fitToContent();
	document.body.setAttribute("preload", "false");
	document.getElementById("addURLText").focus();
}

function uninit() {
	document.removeEventListener("keypress", onKeyPress);
	FoxAgeSvc = null;
	FoxAgeUtils = null;
}

function onKeyPress(event) {
	if (event.key == "Enter")
		addURL();
}

async function addTab() {
	var tabs = await browser.tabs.query({ currentWindow: true, active: true });
	window.top.doCommand("subscribe", null, tabs[0].url);
	window.top.hideLayer();
}

function addURL() {
	var url = document.getElementById("addURLText").value;
	if (!url)
		return;
	window.top.doCommand("subscribe", null, url);
	window.top.hideLayer();
}

window.addEventListener("load", init, { once: true });
window.addEventListener("pagehide", uninit, { once: true });

