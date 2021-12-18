////////////////////////////////////////////////////////////////////////////////
// global

async function init() {
	await getService();
	localize();
	captureKeyEvents();
	disableContextMenu();
	document.querySelector("#device").onchange = onDeviceChange;
	document.querySelector("#entriesOuter").onchange = onEntriesChange;
	document.querySelector("#downloadButton").onclick = onDownloadButton;
	document.querySelector("#resetButton").onclick = onResetButton;
	document.querySelector("#backButton").onclick = onBackButton;
	browser.runtime.onMessage.addListener(onMessage);
	// 同期UIを更新
	updateSyncUI();
	// HTMLのタイトル
	document.title += " - " + browser.i18n.getMessage("options");
	document.body.setAttribute("preload", "false");
}

function uninit() {
	browser.runtime.onMessage.removeListener(onMessage);
	FoxAgeSvc = null;
	FoxAgeUtils = null;
}

function onBackButton(event) {
	if (window.top.hideLayer)
		// サイドバー内
		window.top.hideLayer();
	else
		// about:addons内
		window.history.back();
}

function onDownloadButton(event) {
	var entry = document.querySelector("input[name='entries']:checked");
	if (!entry)
		return;
	FoxAgeSvc.syncDownload(entry.value);
}

function onResetButton(event) {
	if (!window.confirm(browser.i18n.getMessage("delete_confirm")))
		return;
	browser.storage.sync.clear();
	updateSyncUI();
}

function onDeviceChange(event) {
	if (event.target.validity.patternMismatch) {
		event.target.value = "";
		return;
	}
	FoxAgeSvc.setPref("syncDevice", event.target.value);
}

function onEntriesChange(event) {
	document.querySelector("#downloadButton").disabled = false;
}

async function updateSyncUI() {
	var syncDevice = FoxAgeSvc.getPref("syncDevice");
	document.querySelector("#device").value = syncDevice || "";
	var outer = document.querySelector("#entriesOuter");
	while (outer.lastChild) {
		outer.removeChild(outer.lastChild);
	}
	// sync.html#xxxで渡した新着デバイス名を初期選択
	let hash = window.location.hash.substr(1);
	// 最初にボタン無効化しておく
	document.querySelector("#downloadButton").disabled = true;
	browser.storage.sync.get().then(async data => {
		let devices = Object.keys(data).filter(key => !key.includes(":"));
		// 最終アップロード日時の降順でデバイス名をソート
		devices.sort((a, b) => data[b].time - data[a].time);
		let count = 0;
		for (let i = 0; i < devices.length; i++) {
			let device = devices[i];
			if (!data[device].time || !data[device].count)
				return;
			let time = new Date(data[device].time).toLocaleString();
			count += data[device].count;
			// 最終アップロード日時
			let elt = document.querySelector("#entriesTemplate").content.cloneNode(true);
			elt.querySelector("input").id = "entries_" + i;
			elt.querySelector("input").value = device;
			elt.querySelector("label").textContent = time + " | " + device;
			elt.querySelector("label").setAttribute("for", "entries_" + i);
			if (hash && hash == device) {
				elt.querySelector("input").checked = true;
				elt.querySelector("label").style.fontWeight = "bold";
				onEntriesChange();
			}
			outer.appendChild(elt);
		}
		// サイズまたはアイテム数
		let size = await browser.storage.sync.getBytesInUse();
		elt = document.querySelector("#syncSize");
		elt.value = Math.max(size / 102400, count / 512);
		elt.setAttribute("title", (size / 1024).toFixed() + " / 100 KB\n" + count + " / 512 items");
		elt.parentNode.style.display = "block";
		// iframe内での読み込み時
		if (window.top.location.href != window.location.href) {
			fitToContent();
		}
	});
}

async function onMessage(request, sender, sendResponse) {
	switch (request.topic) {
		// 同期 (アップロード) 成功
		case "sync-upload": 
			updateSyncUI();
			break;
		// 同期失敗
		case "sync-error": 
			break;
		default: 
	}
}

window.addEventListener("load", init, { once: true });
window.addEventListener("pagehide", uninit, { once: true });

