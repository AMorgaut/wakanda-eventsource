﻿var	sse,	BASE_PATH;function ServerSentEvent(type, message) {	this.type = type;	this.data = message;	this.send = function send(asJSON) {		var sseMgr = new SharedWorker(sse.WORKER_PATH, sse.WORKER_ID);		sseMgr.port.postMessage({type:ServerSentEvent.SEND_DATAS, data:this.toString(asJSON)});	};};ServerSentEvent.prototype.toString = function toString(asJSON) {	var message = "";	if (this.type !== undefined) {		if (this.type == ServerSentEvent.COMMENT) {			// a comment will just keep the connection alive			// but will not be fired as an event on client side			message += "; comment to be sent \n";		} else {			message += "event:" + this.type + "\n";		}	}	if (this.data != null) {		if (asJSON) {			message += "data:" + JSON.stringify(this.data) + "\n\n";		} else {			message += "data:" + this.data.toString() + "\n\n";		}	}	return message;};sse = exports;BASE_PATH = module.id.substr(0, module.id.lastIndexOf('index'));sse.WORKER_PATH = BASE_PATH + "workers/ServerSentEventManager.js";sse.WORKER_ID = "wakanda-eventsource"ServerSentEvent.SEND_DATAS = "sendDatas";ServerSentEvent.COMMENT = "comment_to_be_send_to_keep_the_connection_alive";sse.ServerSentEvent = ServerSentEvent;sse.start = function () {	application.addHttpRequestHandler("/serverEvents", "serverSentEventsHandler.js", "sendServerEvents");};sse.restart = function () {	application.removeHttpRequestHandler("/serverEvents", "serverSentEventsHandler.js", "sendServerEvents");	application.addHttpRequestHandler("/serverEvents", "serverSentEventsHandler.js", "sendServerEvents");};sse.stop = function () {	application.removeHttpRequestHandler("/serverEvents", "serverSentEventsHandler.js", "sendServerEvents");};sse.sendMessage = function sendMessage (type, message, asJSON) {	var temp = new ServerSentEvent(type, message);	temp.send();};