////////////////////////////////////////////////////////////////////////////////
// FoxAgeUtils

var FoxAgeUtils = {

	TYPE_BOARD    : 1,
	TYPE_THREAD   : 2,
	TYPE_SEPARATOR: 3,

	BBS_UNK  : 0,
	BBS_5CH  : 1,
	BBS_PINK : 2,
	BBS_MACHI: 3,
	BBS_JBBS : 4,

	STATUS_CHECKING: 1,	// 0001(2)
	STATUS_UPDATED : 2,	// 0010(2)
	STATUS_DATOUT  : 4,	// 0100(2)
	STATUS_ERROR   : 8,	// 1000(2)

	DROP_TYPE: "text/foxage-item-id",

	// 「http://...http://」のようにビューアやWebサービスによってラップされたURLについて、
	// 最後のhttp://以降をURLとみなして返す
	unwrapURL: function(aURL) {
		return /^.*(https?:\/\/.+?)$/.test(aURL) ? RegExp.$1 : aURL;
	},

	// 登録可能なURLをパースして、[板のアイテムID, スレッドのアイテムID] の配列へ変換する
	parseFromURL: function(aURL) {
		// unwrapURLは呼び出しもと側で実施する
		// aURL = this.unwrapURL(aURL);
		if (!/^https?:\/\//.test(aURL))
			throw new Error("invalid URL");
		aURL = RegExp.rightContext;
		if (/\/test\/read\.(?:cgi|so|html)\/(\w+)\/(\d+)/.test(aURL))
			// 5ちゃんねるスレッド
			// https://egg.5ch.net/test/read.cgi/software/1234567890/l50
			// [0] egg.5ch.net/software
			// [1] egg.5ch.net/software/1234567890
			return [
				RegExp.leftContext + "/" + RegExp.$1,
				RegExp.leftContext + "/" + RegExp.$1 + "/" + RegExp.$2
			];
		else if (/\/bbs\/read\.cgi\/(\w+)\/(\d+)\/(\d+)\//.test(aURL))
			// したらばスレッド
			// 注意: まちBBSスレッド用の正規表現と類似しているため、したらばの条件を優先しなければならない
			// http://jbbs.livedoor.jp/bbs/read.cgi/anime/1234/1234567890/l50
			// [0] jbbs.livedoor.jp/anime/1234
			// [1] jbbs.livedoor.jp/anime/1234/1234567890
			return [
				RegExp.leftContext + "/" + RegExp.$1 + "/" + RegExp.$2,
				RegExp.leftContext + "/" + RegExp.$1 + "/" + RegExp.$2 + "/" + RegExp.$3
			];
		else if (/\/bbs\/read\.cgi\/(\w+)\/(\d+)\//.test(aURL))
			// まちBBSスレッド
			// http://kanto.machi.to/bbs/read.cgi/kana/1234567890
			// [0] kanto.machi.to/kana
			// [1] kanto.machi.to/kana/1234567890
			return [
				RegExp.leftContext + "/" + RegExp.$1,
				RegExp.leftContext + "/" + RegExp.$1 + "/" + RegExp.$2
			];
		else if (/\/read\.php\?host=([^&]+)&bbs=([^&]+)&key=([^&]+)/.test(aURL))
			// p2/rep2で開いたスレッド
			return [
				RegExp.$1 + "/" + RegExp.$2,
				RegExp.$1 + "/" + RegExp.$2 + "/" + RegExp.$3
			];
		else if (/\/subject\.php\?host=([^&]+)&bbs=([^&]+)/.test(aURL))
			// p2/rep2で開いた板
			return [
				RegExp.$1 + "/" + RegExp.$2,
				null
			];
		else if (/^\w+\.(?:2ch\.net|5ch\.net|bbspink\.com|machi\.to)\/\w+\//.test(aURL) || 
		         /^jbbs\.shitaraba\.net\/\w+\/\d+\//.test(aURL))
			// 5ちゃんねる板・まちBBS板・したらば板
			return [
				aURL.substr(0, aURL.lastIndexOf("/")),
				null
			];
		else
			throw new Error("invalid URL");
	},

	// 板またはスレッドのアイテムIDをパースしてURLへ変換する
	parseToURL: function(aItem, aHttps) {
		var url = "";
		if (aItem.type == this.TYPE_BOARD)
			url = this._parseToBoardURL(aItem);
		else if (aItem.type == this.TYPE_THREAD)
			url = this._parseToThreadURL(aItem);
		// HTTPSオプションが有効なら5ch.netに限りプロトコルを変更
		if (aHttps && url.indexOf(".5ch.net/") >= 0)
			url = url.replace("http://", "https://");
		return url;
	},

	// 板のアイテムIDをパースしてURLへ変換する
	_parseToBoardURL: function(aItem) {
		return "http://" + aItem.id + "/";
	},

	// スレッドのアイテムIDをパースしてURLへ変換する
	_parseToThreadURL: function(aItem) {
		var parts = aItem.id.split("/");
		var key = parts.pop();
		var bbs = parts.pop();
		var host = parts.shift();
		var path = parts.join("/");
		var url = "http://";
		if (host == "jbbs.shitaraba.net")
			url += host + "/bbs/read.cgi/" + path + "/" + bbs + "/" + key + "/";
		else if (host.endsWith(".machi.to"))
			url += host + "/bbs/read.cgi/" + bbs + "/" + key + "/";
		else
			url += host + (path ? "/" + path : "") + "/test/read.cgi/" + bbs + "/" + key + "/";
		return url;
	},

	// egg.5ch.net/software/1234567890 → 1234567890
	// egg.5ch.net/software/1234567890 → 1234567890
	threadKeyOfItem: function(aItem) {
		if (aItem.type != this.TYPE_THREAD)
			return null;
		return aItem.id.substr(aItem.id.lastIndexOf("/") + 1);
	},

	// 板のアイテムを生成する
	createBoardItem: function(aItemId, aTitle) {
		var bbs;
		if (aItemId.indexOf(".5ch.net") >= 0)
			bbs = this.BBS_5CH;
		else if (aItemId.indexOf(".bbspink.com") >= 0)
			bbs = this.BBS_PINK;
		else if (aItemId.indexOf(".machi.to") >= 0)
			bbs = this.BBS_MACHI;
		else if (aItemId.indexOf("jbbs.shitaraba.net") >= 0)
			bbs = this.BBS_JBBS;
		else
			bbs = this.BBS_UNK;
		return {
			id: aItemId,
			type: this.TYPE_BOARD,
			title: aTitle || aItemId,
			parent: "root",
			status: 0,
			bbs: bbs,
			checkDate: 0,
			open: true
		};
	},

	// スレッドのアイテムを生成する
	createThreadItem: function(aItemId, aBoardItem, aTitle) {
		return {
			id: aItemId,
			type: this.TYPE_THREAD,
			title: aTitle || aItemId,
			parent: aBoardItem.id,
			status: 0,
			readRes: 0,
			lastRes: 0,
			maxRes: aBoardItem.maxRes,
		};
	},

	// 区切りのアイテムを生成する
	createSeparatorItem: function(aTitle) {
		return {
			id: "separator:" + Date.now(),
			type: this.TYPE_SEPARATOR,
			title: aTitle || "",
			parent: "root",
		};
	},

	// 「&」「<」「>」「"」の実体参照をデコードする
	unescapeEntities: function(aString) {
		aString = aString.replace(/&amp;/g, '&');
		aString = aString.replace(/&lt;/g, '<');
		aString = aString.replace(/&gt;/g, '>');
		aString = aString.replace(/&quot;/g, '"');
		return aString;
	},

	// タイトルの余計な文字列を削除する
	sanitizeTitle: function(aTitle) {
		aTitle = aTitle.replace(" - 5ちゃんねる掲示板", "");
		aTitle = aTitle.replace(/ - \d{10} - したらば掲示板/, "");
		aTitle = aTitle.replace("[転載禁止]", "", "g");
		aTitle = aTitle.replace("[無断転載禁止]", "", "g");
		aTitle = aTitle.replace("&copy;5ch.net", "", "g");	// ©5ch.net
		aTitle = aTitle.replace("&#169;5ch.net", "", "g");	// ©5ch.net
		aTitle = aTitle.replace("&copy;5ch.net", "", "g");	// ©5ch.net
		aTitle = aTitle.replace("&#169;5ch.net", "", "g");	// ©5ch.net
		aTitle = aTitle.replace("&copy;bbspink.com", "", "g");	// ©bbspink.com
		aTitle = aTitle.replace("&#169;bbspink.com", "", "g");	// @bbspink.com
		aTitle = aTitle.replace(/■|◆|●|★|☆/g, " ");
		aTitle = aTitle.replace(/[\u0000-\u001F]/g, "");	// 制御文字
		aTitle = aTitle.replace(/\s+/g, " ");	// 連続する空白
		aTitle = aTitle.replace(/^\s+|\s+$/g, "");	// 先頭・末尾の空白
		return aTitle;
	},

	// HTTPRequestインスタンスを生成する
	createHTTPRequest: function() {
		return new HTTPRequest();
	},

};


////////////////////////////////////////////////////////////////////////////////
// HTTPでのリクエストを行うクラス

function HTTPRequest() {
	// インスタンスが処理中かどうかを表すフラグ。
	this.active = true;
}

HTTPRequest.prototype = {

	// XMLHttpRequestのインスタンス
	_request: null,

	// 要求先URL
	_requestURL: null,

	// 必要に応じて関連アイテムのIDをセットする
	itemId: null,

	// 各種コールバック関数
	_loadCallback : function(aResponseText) {},
	_errorCallback: function(aHttpStatus) {},

	// 指定したURLへGETメソッドでリクエストを送信する
	// @param string aURL 接続先URL
	// @param function aLoadCallback 正常レスポンス時のコールバック関数。引数はレスポンステキスト。
	// @param function aErrorCallback 異常レスポンス時のコールバック関数。引数はHTTPステータス。
	// リダイレクトが発生した場合も異常レスポンスとみなす。
	send: function(aURL, aLoadCallback, aErrorCallback) {
//		aURL = aURL.replace("://", "://www.xuldev.org/foxage/");	// #debug
//		aURL = "http://slowwly.robertomurray.co.uk/delay/3000/url/";	// #debug
		var charset = aURL.indexOf("://jbbs.shitaraba.net/") >= 0 ? "EUC-JP" : "Shift_JIS";
		this._requestURL = aURL;
		this._loadCallback  = aLoadCallback;
		this._errorCallback = aErrorCallback;
		this._request = new XMLHttpRequest();
		this._request.addEventListener("load", this, { once: true });
		this._request.addEventListener("error", this, { once: true });
		this._request.addEventListener("abort", this, { once: true });
		this._request.addEventListener("timeout", this, { once: true });
		this._request.open("GET", aURL, true);
		this._request.timeout = 30 * 1000;
		this._request.setRequestHeader("Cache-Control", "no-cache");
		this._request.setRequestHeader("User-Agent", "Monazilla/1.00 (FoxAge5ch)");
		this._request.overrideMimeType("text/plain; charset=" + charset);
		this._request.send(null);
	},

	// 仕掛かり中の処理をすべて中止して他オブジェクトへの参照を破棄する。
	destroy: function() {
		if (this._request) {
			this._request.removeEventListener("load", this);
			this._request.removeEventListener("error", this);
			this._request.removeEventListener("abort", this);
			this._request.removeEventListener("timeout", this);
			this._request.abort();
			this._request = null;
		}
		this._requestURL = null;
		this._loadCallback = null;
		this._errorCallback = null;
		this.itemId = null;
		this.active = false;
	},

	handleEvent: function(event) {
		try {
			// 一部の鯖（uni.2ch.netなど）で、移転済みにも関わらずsubject.txtがリダイレクトされず
			// HTTPステータス200で返ってくるため、その中身まで見ないと移転済みかを判別できない。
			var validateResponse = function(aText) {
				if (!aText)
					return false;
				var lines = aText.split("\n");
				return (
					lines.length == 3 && 
					lines[0].indexOf("9246366142.dat<>") == 0 && 
					lines[1].indexOf("9248888888.dat<>") == 0
				);
			};
			if (event.type == "load" && this._request.status == 200 && 
			    this._requestURL == this._request.responseURL && 
			    !validateResponse(this._request.responseText))
				this._loadCallback(this._request.responseText);
			else
				// ステータス0 (ソケットエラー)
				// ステータス301 (リダイレクト)
				// ステータス302 (人大杉)
				// ステータス403 (バーボンハウス)
				// レスポンステキストなし (移転済み板のsubject.txt)
				// 9246366142.datと9248888888.datしかない (移転済み)
				// http://www2.2ch.net/live.html (人大杉)
				// http://server.maido3.com/ (移転済み？)
				// errorイベント時（ネットワークエラー）
				// abortイベント時（明示的な中止）
				// timeoutイベント時（一定時間のタイムアウト）
				this._errorCallback(this._request.status);
		}
		catch (ex) { console.error("HTTPRequest error: " + ex); }	// #debug
		finally {
			this.destroy();
		}
	},

};


