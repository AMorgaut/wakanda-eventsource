/**
 * @module wakanda-eventsource
 **/

var
	BASE_PATH,
	ID,
	EVENT,
	DATA,
	RETRY,
	COMMENT,
	EOL,
	EOL2,
	sse,
	worker,
	workerPort,
	workerListeners,
	eventListeners,
	eventListenerProxies,
	toString;

BASE_PATH = module.id.substr(0, module.id.lastIndexOf('index'));
ID = 'id: ';
EVENT = 'event: ';
DATA = 'data: ';
RETRY = 'retry: ';
COMMENT = ': ';
EOL = '\n';
EOL2 = EOL + EOL;
workerListeners = [];
eventListeners = {};
eventListenerProxies = {};
toString = Object.prototype.toString;

/**
 * @class ServerEvent
 * @constructor
 * @param {mixed} message data to push
 * @param {string} [type] event type
 **/
function ServerEvent(message, type) {
	this.id = Date.now();
	this.type = type;
	this.data = message;
}


/**
 * @method send
 * @param {boolean} [asJSON] false by default. message is JSON encoded is set to true
 * @param {boolean|Object} [options] comment flag or list of users or sessions
 **/
ServerEvent.prototype.send = function send(asJSON, options) {
	var
		isComment;

	isComment = typeof options === 'object' ? false : Boolean(isComment);
	workerPort.postMessage({
		id: this.id,
		type: sse.PUSH, 
		event: this.type,
		isComment: isComment,
		message: this.toString(asJSON, isComment),
		sessions: options && options.sessions,
		users: options && options.users
	});
};


/**
 * Convert a server event into an eventstream compliant string
 *
 * @method toString
 * @param {boolean} [asJSON] false by default. message is JSON encoded is set to true
 * @param {boolean} [isComment] false by default. message sent as a protocol level comment
 **/
ServerEvent.prototype.toString = function toString(asJSON, isComment) {
	var
		id,
		data,
		type;

	id = ID + this.id + EOL;
	data = this.data;
	if (data) {
		if (asJSON) {
			// \n will be natively escaped by JSON.stringify() and restored by JSON.parse()
			data = JSON.stringify(data);
		} else {
			// \n must be replaced for the textstream protocol by \ndata:
			data = String(data).split(EOL).join(EOL + DATA);
		}
		data = DATA + data;
	}

	if (isComment) {
		return COMMENT + this.data + EOL2;
	}

	type = this.type;
	if (!type) {
		// standard MessageEvent
		return id + data + EOL2;
	}

	// specific Server Event
	return id + EVENT + this.type + EOL + data + EOL2;
};


// PUBLIC API

/**
 * @class WakandaEventsourceModule
 **/

sse = exports;


/**
 * @property WORKER_PATH
 * @type string
 **/ 
sse.WORKER_PATH = BASE_PATH + "eventSource-sharedWorker.js";


/**
 * @property WORKER_ID
 * @type string
 * @default "wakanda-eventsource"
 **/ 
sse.WORKER_ID = "wakanda-eventsource";


/**
 * @property PATTERN
 * @type string
 * @default "/eventsource"
 **/ 
sse.PATTERN = "^/EventSource";


/**
 * @property HTTP_HANDLER_PATH
 * @type string
 **/ 
sse.HTTP_HANDLER_MODULE = "wakanda-eventsource/eventSource-httpHandler";


/**
 * @property HTTP_HANDLER_NAME
 * @type string
 * @default "oneventsourceconnect"
 **/ 
sse.HTTP_HANDLER_METHOD = "oneventsourceconnect";


/**
 * @property CONNECTION_READY
 * @type string
 * @default "connectionready"
 **/ 
sse.CONNECTION_READY = "connectionready";


/**
 * @property CONNECTION_READY
 * @type string
 * @default "connectionready"
 **/ 
sse.START_SOCKET_SERVER = "startSocketServer";


/**
 * @property PUSH
 * @type string
 * @default "push"
 **/ 
sse.PUSH = "push";


/**
 * @property COMMENT
 * @type string
 * @default ": "
 **/ 
sse.COMMENT = COMMENT;


/**
 * @property EOL
 * @type string
 * @default "\n"
 **/ 
sse.EOL = EOL;


/**
 * @property STOP
 * @type string
 * @default "stop"
 **/ 
sse.STOP = "stop";


worker = new SharedWorker(sse.WORKER_PATH, sse.WORKER_ID);
workerPort = worker.port;
workerPort.onmessage = function onworkermessage(message) {
	workerListeners.forEach(function callListener(listener) {
		listener(message);
	});
};


/**
 * ServerEvent constructor
 *
 * @property ServerEvent
 * @type function
 **/ 
sse.ServerEvent = ServerEvent;


/**
 * @method start
 **/ 
sse.start = function start(options) {
	var
		pattern,
		port;

	switch (typeof options) {
	case 'string':
		options = {pattern: options};
		break;
	case 'number':
		options = {port: options};
		break;
	case 'object':
		options = options || {}; // handle null
		break;
	default:
		options = {};
	}
	if (!options.pattern) {
		options.pattern = sse.PATTERN;
	}
	if (options.port && parseInt(options.port, 10) === Number(port)) {
		workerPort.postMessage({
			type: sse.START_SOCKET_SERVER,
			options: options
		});
	}
	if (!options.newPortOnly) {
		application.addHttpRequestHandler(options.pattern, sse.HTTP_HANDLER_MODULE, sse.HTTP_HANDLER_METHOD);
	}
};


/**
 * @method restart
 **/ 
sse.restart = function restart(options) {
	sse.stop();
	sse.start(options);
};


/**
 * @method pause
 * @param {number} delay
 **/ 
sse.pause = function pause(delay) {
	application.removeHttpRequestHandler(sse.PATTERN, sse.HTTP_HANDLER_PATH, sse.HTTP_HANDLER_NAME);
	setTimeout(function () {
		application.addHttpRequestHandler(sse.PATTERN, sse.HTTP_HANDLER_PATH, sse.HTTP_HANDLER_NAME);
	}, delay);
	workerPort.postMessage({
		type: sse.PUSH,
		message: RETRY + Number(delay)
	});
};


/**
 * @method stop
 **/ 
sse.stop = function stop() {
	application.removeHttpRequestHandler(sse.PATTERN, sse.HTTP_HANDLER_PATH, sse.HTTP_HANDLER_NAME);
	workerPort.postMessage({type: 'stop'});
};


/**
 * @method countConnections
 * @results {number}
 **/ 
sse.countConnections = function countConnections(comment, asJSON) {
	var
		nbConnections;

	function readCount(event) {
		nbConnections = event.data;
		workerListeners.splice(workerListeners.indexOf(readCount), 1);
		exitWait();
	}

	workerPort.postMessage({type: 'countConnections'});
	workerListeners.push(readCount);
	wait();
	return nbConnections;
};


/**
 * @method push
 * @param {mixed} message data to push
 * @param {boolean} [asJSON]
 **/ 
sse.push = function push(message, asJSON) {
	var
		temp;

	temp = new ServerEvent(message);
	temp.send(asJSON);
};


/**
 * @method pushEvent
 * @param {string} type event type
 * @param {mixed} message data to push
 * @param {boolean} [asJSON]
 **/ 
sse.pushEvent = function pushEvent(type, message, asJSON) {
	var
		temp;

	temp = new ServerEvent(message, type);
	temp.send(asJSON);
};


/**
 * @method pushEventToSession
 * @param {Array|User|string} sessions targeted sessions for the event
 * @param {string} type event type
 * @param {mixed} message data to push
 * @param {boolean} [asJSON]
 **/ 
sse.pushEventToSession = function pushEventToSession(sessions, type, message, asJSON) {
	var
		temp;

	temp = new ServerEvent(message, type);
	temp.send(asJSON, {sessions: sessions});
};


/**
 * @method pushEventToUser
 * @param {Array|User|string} users targeted users for the event
 * @param {string} type event type
 * @param {mixed} message data to push
 * @param {boolean} [asJSON]
 **/ 
sse.pushEventToUser = function pushEventToUser(users, type, message, asJSON) {
	var
		temp,
		userIDs;

	if (!Array.isArray(users)) {
		users = [users];
	}
	userIDs = [];
	users = users.forEach(function addUsersToTargetList(user) {
		if (!user) {
			return;
		}
		if (typeof user === 'object') {
			// get potential group ID
			user = user.ID;
		}
		user = directory.user(user);
		if (!user) {
			// user was not a valid user object, id, or name
			return;
		}
		userIDs.push(user.ID);
	});
	temp = new ServerEvent(message, type);
	temp.send(asJSON, {users: userIDs});
};


/**
 * @method pushEventToGroup
 * @param {Array|Group|string} groups targeted groups for the event
 * @param {string} type event type
 * @param {mixed} message data to push
 * @param {boolean} [asJSON]
 **/ 
sse.pushEventToGroup = function pushEventToUser(groups, type, message, asJSON) {
	var
		temp,
		users;

	if (!Array.isArray(groups)) {
		groups = [groups];
	}
	users = [];
	groups.forEach(function addGroupUsersToTargetList(group) {
		if (!group) {
			return;
		}
		if (typeof group === 'object') {
			// get potential group ID
			group = group.ID;
		}
		group = directory.group(group);
		if (!group) {
			// group was not a valid group object, id, or name
			return;
		}
		// add users from the valid group object
		users = users.concat(group.getUsers());
	});
	sse.pushEventToUser(users, type, message, asJSON);
};


/**
 * @method pushComment
 * @param {mixed} comment to push
 * @param {boolean} [asJSON]
 **/ 
sse.pushComment = function pushEvent(comment, asJSON) {
	var
		temp;

	temp = new ServerEvent(comment);
	temp.send(asJSON, true);
};


/**
 * @method addListener
 * @param {string} event
 * @param {Function|Array} handler
 **/
sse.addListener =  function addListener(event, handler) {
	var
		listenerProxy,
		listeners,
		listenerProxies,
		subscription;

	subscription = {
		type: 'listen',
		event: event
	};

	if (typeof handler === 'function') {
	
		listeners = eventListeners[event] || [];
		eventListeners[event] = listeners;

		listenerProxies = eventListenerProxies[event] || [];
		eventListenerProxies[event] = listenerProxies;

		listenerProxy = function listenerProxy(event) {
			handler({
				type: event,
				data: event.data
			});
		};
		listeners.push(handler);
		listenerProxies.push(listenerProxy);

		workerListeners.push(listenerProxy);
		
	} else if (Array.isArray(handler)) {

		subscription.handler = handler;

	} else {

		return false;

	}

	workerPort.postMessage(subscription);

	return true;
};




/**
 * @method removeListener
 * @param {string} event
 * @param {Function|Array} handler
 **/
sse.removeListener =  function removeListener(event, handler) {
	var
		listenerIndex,
		listeners,
		listenerProxies,
		listenerProxy,
		subscription;

	subscription = {
		type: 'unlisten',
		event: event
	};

	if (typeof handler === 'function') {
	
		listeners = eventListeners[event] || [];
		eventListeners[event] = listeners;

		listenerProxies = eventListenerProxies[event] || [];
		eventListenerProxies[event] = listenerProxies;

		listenerIndex = listeners.indexOf(handler);
		listenerProxy = listenerProxies[listenerIndex];
		listeners.splice(listenerIndex, 1);
		listenerProxies.splice(listenerIndex, 1);

		workerListeners.splice(workerListeners.indexOf(listenerProxy), 1);
		
	} else if (Array.isArray(handler)) {

		subscription.handler = handler;

	} else {

		return false;

	}

	workerPort.postMessage(subscription);

	return true;
};