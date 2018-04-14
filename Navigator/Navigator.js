/**
 * a Navigator
 * @class 
 * @param {baseUrl} default base URL for outbound requests
 * @implements {Navigator}
 * @return {Navigator} a new Navigator
 */
function Navigator(baseUrl) {
	var hostStart = baseUrl.indexOf("//") + 2;
	if (hostStart < 2) {
		throw new Error("Invalid base URL. Must be in the format protocol://host");
	}
	var hostEnd = baseUrl.indexOf("/", hostStart);
	if (hostEnd < 0) {
		hostEnd = baseUrl.length;
		baseUrl += "/";
	}
	this.baseUrl = baseUrl;
	this.logoutIndicator = "";
	this.saveCookies = false;
	this.refetchOnLogin = false;
	this.debug = false;
	this.host = baseUrl.substring(hostStart, hostEnd);
	return this;
}

/**
 * if set, cookies will be saved in {@link PropertiesService.getScriptProperties()}
 * @param {saveCookies} true if properties should be saved
 */
Navigator.prototype.setSaveCookies = function(saveCookies) { this.saveCookies = saveCookies }

/**
 * if saveCookies is set, decides the base username for saving cookies in the properties store (key <cookieUsername>_cookie_<cookieName>)
 * @param {cookieUsername} base username for cookies
 */
Navigator.prototype.setCookieUsername = function(cookieUsername) { this.cookieUsername = cookieUsername }

/**
 * returns current 'Cookie' header
 * @return current 'Cookie' header string
 */
Navigator.prototype.getCookies = function() { return this.cookie }

/**
 * returns headers received in the last navigation
 * @return headers from the last navigations
 */
Navigator.prototype.getLastHeaders = function() { return this.lastHeaders }

/**
 * sets an absolute (starting with protocol://) or relative path for login requests to base website
 * @param {loginPath} path for login requests
 */
Navigator.prototype.setLoginPath = function(loginPath) { this.loginPath = loginPath }

/**
 * sets the payload to be submitted during login (for automatic relogin)
 * @param {loginPayload} the login request payload
 */
Navigator.prototype.setLoginPayload = function(loginPayload) { this.loginPayload = loginPayload }

/**
 * if set, an automatic relogin will be performed whenever this content fragment is encountered in the response body
 * @param {logoutIndicator} content indicating a logout, for attempting relogin
 */
Navigator.prototype.setLogoutIndicator = function(logoutIndicator) { this.logoutIndicator = logoutIndicator }

/**
 * if set, when an automatic login is executed during a URL request, the original request will be replayed after login
 * @param {refetchOnLogin} true if refetch is required in case of a relogin
 */
Navigator.prototype.setRefetchOnLogin = function(refetchOnLogin) { this.refetchOnLogin = refetchOnLogin }

/**
 * if set, logs would be generated for each request
 * @param {debug} true if request debug logging should be enabled
 */
Navigator.prototype.setDebug = function(debug) { this.debug = debug }

/**
 * executes a GET request
 * @param {path} the destination path (relative or absolute)
 * @return the response payload
 */
Navigator.prototype.doGet = function(path) {
	return this.sendRequest(path, {host: this.host});
};

/**
 * executes a POST request
 * @param {path} the destination path (relative or absolute)
 * @param {payload} the payload (will be {@link UrlFetchApp}-escaped unless a String) to be sent with the request
 * @param {headers} an array of key-value pair headers to be sent with the request
 * @return the response payload
 */
Navigator.prototype.doPost = function(path, payload, headers) {
	// prepare UrlFetchApp options
	var options = {
		host: this.host,
		method: "POST"
	};
	// POST payload
	options.payload = payload;
	if (payload instanceof String) {
		options.escaping = false;
	}
	// extra headers
	options.headers = {};
	if (headers) {
		for (h in headers) {
			options.headers[h] = headers[h];
		}
	}
	return this.sendRequest(path, options);
};

/**
 * executes an arbitrary request in {@link UrlFetchApp} style
 * @param {path} the destination path (relative or absolute)
 * @param {options} a {@link UrlFetchApp}-compatible options object
 * @return the response payload
 */
Navigator.prototype.sendRequest = function(path, options) {
	var setReferer = function(ref) {
		options.referer = options.headers.referer = this.referer = ref;
	};

	var pgUrl = path.indexOf("//") > 0 ? path : this.baseUrl + path;
	var loginUrl = this.loginPath.indexOf("//") > 0 ? this.loginPath : this.baseUrl + this.loginPath;

	// try using old cookie
	var cookie = this.cookie;
	if (!cookie && this.saveCookies) {
		var key = this.host + "_cookie_" + this.cookieUsername;
		var props = PropertiesService.getScriptProperties();
		this.cookie = cookie = props.getProperty(key);
	}
	if (!this.paths) {
		this.paths = this.saveCookies ? JSON.parse(props.getProperty(key + "_paths") || "{}") : {};
	}

	if (!options.headers) {
		options.headers = {};
	}
	if (cookie) {
		options.headers.cookie = cookie;
	} else {
		cookie = "";
	}
	options.followRedirects = false;
	setReferer(this.referer ? this.referer : loginUrl);

	// open actual page
	var url = pgUrl;
	var headers = [];
	do {
		if (this.debug) {
			Logger.log(url);
			Logger.log(options);
		}

		response = UrlFetchApp.fetch(url, options);
		headers = response.getAllHeaders();
		if (this.debug) {
			Logger.log(headers);
		}
		options.headers.cookie = cookie = this.updateCookies(cookie, headers['Set-Cookie']);
		if (this.debug) {
			Logger.log(cookie);
		}
		setReferer(url);
		options.method = "GET"; // redirect
	} while (url = headers['Location']);
	var str = response.getContentText();

	// logout indicator => need to log in and refresh cookies
	if(str.indexOf(this.logoutIndicator) > 0) {
		var logResponse = UrlFetchApp.fetch(loginUrl, {
			method: "POST",
			host: this.host,
			headers: {
				cookie: cookie,
				referer: this.referer
			},
			referer: this.referer,
			payload: this.loginPayload,
			followRedirects: false
		});

		// update cookies
		setReferer(loginUrl);
		options.headers.cookie = cookie = this.updateCookies(cookie, logResponse.getAllHeaders()['Set-Cookie']);
		if (this.saveCookies) {
			props.setProperty(key, cookie);
			props.setProperty(key + "_paths", JSON.stringify(this.paths));
		}

		// refetch page if required
		if (this.refetchOnLogin) {
			str = UrlFetchApp.fetch(pgUrl, options).getContentText();
			setReferer(pgUrl);
		}
	}
	return str;
};

/**
 * updates the local cookie cache with cookies received from a request, and returns the computed 'Cookie' header
 * @param {cookie} the current 'Cookie' header (string)
 * @param {rawCook} the cookie string ('Set-Cookie' header) received in a request
 * @return the updated 'Cookie' header string
 */
Navigator.prototype.updateCookies = function(cookie, rawCook) {
	if (!rawCook)
		return cookie;
	if (!(rawCook instanceof Array)) {
		rawCook = [rawCook];
	}
	for (var i in rawCook) {
		var c = rawCook[i];
		var name = c.substring(0, c.indexOf('='));

		var domainPos = c.indexOf("Domain=");
		var pathPos = c.indexOf("Path=");
		var path = domainPos > 0 ? c.substring(domainPos + 7, c.indexOf(";", domainPos)) : "*";
		path += pathPos > 0 ? c.substring(pathPos + 5, c.indexOf(";", pathPos)) : "*";
		var curPath = this.paths[name];
		if (!curPath) {
			curPath = this.paths[name] = "";
		}

		var pos = cookie.indexOf(name);
		if (pos >= 0 && curPath.indexOf(path + "|") >= 0) { // replace
			var endPos = cookie.indexOf(';', pos)
			if (endPos < 0) {
				endPos = cookie.length;
			}
			cookie = cookie.substring(0, pos) + c.substring(0, c.indexOf(';')) + cookie.substring(endPos);
		}
		else {			// append
			if (cookie.length > 0) {
				cookie += '; ';
			}
			var end = c.indexOf(';');
			cookie += c.substring(0, end > 0 ? end : c.length);
			this.paths[name] += path + "|";
		}
	}
	this.cookie = cookie;
	return cookie;
};

/**
 * similar to {@link extract} but is specialized for extracting form field values ("value" attributes)
 * @param {body} the HTML payload string
 * @param {locator} locator of the form field to be extracted (appearing before value)
 * @return value of the form field
 */
function getFormParam(body, locator) {
	return extract(body, "value", locator);
}

/**
 * extracts a given tag attribute from a HTML payload based on a given locator; assumes locator appears before the attribute
 * @param {body} the HTML payload string
 * @param {key} key of the tag attribute
 * @param {locator} locator of the form field to be extracted (appearing before key)
 * @return value of the form field
 */
function extract(body, key, locator) {
	return extractWith(function(a, b) { return body.indexOf(a, b) }, body, key, locator);
}

/**
 * similar to {@link extract} but performs a reverse match (for cases where the locator appears after the attribute)
 * @param {body} the HTML payload string
 * @param {key} key of the tag attribute
 * @param {locator} locator of the form field to be extracted (appearing after key)
 * @return value of the form field
 */
function extractReverse(body, key, locator) {
	return extractWith(function(a, b) { return body.lastIndexOf(a, b) }, body, key, locator);
}

function extractWith(func, body, key, locator) {
	var p = func(key, body.indexOf(locator)) + key.length + 2; // ="
	if (p < key.length + 2) throw new Error("Missing " + key);
	var quote = body.substring(p - 1, p);
	return body.substring(p, body.indexOf(quote, p));
}