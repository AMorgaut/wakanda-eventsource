var
	buffer,
	clientPorts,
	portsMap,
	waitReconnect,
	events,
	sse;

clientPorts = [];

portsMap = {
    session: {},
    user: {}
};

waitReconnect = {};

events = {
	disconnectListeners: []
};

buffer = [];
buffer.MAX_AGE = 2 * 60 * 60 * 1000; // 2 hours
buffer.MAX_EVENTS = 500;
buffer.MAX_SIZE = 2 * 1024 * 1024; // 2 Mb
buffer.INCLUDE_COMMENTS = false; // 2 Mb
buffer.size = 0;

//sse = require("wakanda-eventsource");
sse = {
    PUSH: 'push',
    EOL: '\n',
    CONNECTION_READY: 'connectionready',
    STOP : 'stop'
};

self.onconnect = function onconnect(msg) {
	var
		port;

	port = msg.ports[0];
	port.onmessage = function onmessage(event) {
		var
			data,
			sessions,
			users,
			missedEvents,
			expiredEvent,
			currentIndex,
			current;

		function dispatchData(clientConnection, index, list) {
		    var
		        filter,
		        event;

			if (!clientConnection || !clientConnection.postMessage) {
				// WORKER CONNECTION LOST ?
				// HTTP CONNECTION CLOSED BY CLIENT ?
				list.splice(index, 1);
				return;
			}

			if (data.isComment && clientConnection.config.noComment) {
			    // comments refused by this connection
			    return;
			}

			filter = clientConnection.config.eventsFilter || [];
			event = data.event || 'message';
			if (filter.length && filter.indexOf(data.event) === -1) {
			    // event not listened by this connection
			    return;
			}
			
			clientConnection.postMessage({
				type: sse.PUSH, 
				message: data.message
			});
		}

		data = event.data;
		switch (data.type) {

		case "settings":
			// UPDATE EventSource Server settings
			if (typeof data.maxAge === 'number') {
			    buffer.MAX_AGE = data.bufferMaxAge;
			}
			if (typeof data.maxAge === 'number') {
			    buffer.MAX_EVENTS = data.bufferMaxEvents;
			}
			if (typeof data.maxAge === 'number') {
			    buffer.MAX_SIZE = data.bufferMaxSize;
			}
			if (typeof data.maxAge === 'boolean') {
			    buffer.INCLUDE_COMMENTS = data.bufferIncludeComments;
			}
			break;

		case sse.PUSH:
			// MESSAGE PUSHED via ServerSent.prototype.send()
			// log to buffer
			buffer.push(data);
			// manage max age
			data.timeoutID = setTimeout(function () {
				buffer.splice(buffer.indexOf(data), 1);
				buffer.size -= data.message.length;
				data = null;
			}, buffer.MAX_AGE);
			buffer.size += data.message.length;
			// manage max number of events and max size
			while (buffer.length > buffer.MAX_EVENTS || buffer.size > buffer.MAX_SIZE) {
				expiredEvent = buffer.shift();
				buffer.size -= expiredEvent.message.length;
				clearTimeout(expiredEvent.timeoutID);
			}
			// push to targets
			if (data.sessions) {
				// send to specific sessions
				sessions = data.sessions;
				if (!Array.isArray(data.sessions)) {
					sessions = [sessions];
				}
				sessions = sessions.map(function dispatchToSession(session) {
					if (typeof session === 'string') {
						return portsMap.session[session];
					}
					if (typeof session === 'object' && session && session.ID) { 
						return portsMap.session[session.ID];
					}
				});
				sessions.forEach(dispatchData);
			} else if (data.users) {
				// send to specific users
				users = data.users;
				if (!Array.isArray(data.users)) {
					users = [users];
				}
				users.forEach(function dispatchToUser(user) {
					if (typeof user === 'string' && portsMap.user[user]) {
						portsMap.user[user].forEach(dispatchData);
					}
					if (typeof user === 'object' && user && user.ID && portsMap.user[user.ID]) { 
						portsMap.user[user.ID].forEach(dispatchData);
					}
				});
			} else {
				// send to any connection
				clientPorts.forEach(dispatchData);
			}
			break;

		case "register":
			// HTTP REQUEST HANDLER CONNECTIONS
			port.config = data;
			clientPorts.push(port);
			if (data.session) {
				delete waitReconnect[data.session];
				portsMap.session[data.session] = port;
			}
			if (data.user) {
				if (portsMap.user[data.user] === undefined) {
					portsMap.user[data.user] = [];
				}
				portsMap.user[data.user].push(port);
			}
			// restore potential event since lastEventId
			if (typeof data.lastEventId === 'number') {
				missedEvents = [];
				currentIndex = buffer.length;
				current = buffer[currentIndex];
				while (current && current.id > data.lastEventId) {
					missedEvents.unshift(current.message);
					currentIndex -= 1;
					current = buffer[currentIndex];
				}
				if (missedEvents.length) {
					port.postMessage({
						type: sse.PUSH, 
						message: missedEvents.join(sse.EOL)
					});
				}
			}
			// valid connection
			port.postMessage({
				type: sse.CONNECTION_READY
			});
			break;

		case 'countConnections':
			port.postMessage(clientPorts.length);
			break;

		case "disconnect":
			clientPorts.splice(clientPorts.indexOf(port), 1);
			delete portsMap.session[data.session];
			delete portsMap.user[data.user];
			if (typeof port.close === 'function') {
				port.close();
			}
			waitReconnect[data.session] = true;
			setTimeout(function () {
				if (waitReconnect[data.session]) {
					// not auto-reconnected
					events.disconnectListeners.forEach(function (port) {
						port.postMessage({
							type: 'event',
							event: 'disconnect',
							session: data.session,
							user: data.user
						});
					});
					delete waitReconnect[data.session];
				}
			}, data.delay);
			break;

		case 'listen':
			events[data.event + 'Listeners'].push(port);
			break;

		case 'unlisten':
			events[data.event + 'Listeners'].splice(events[data.event + 'Listeners'].indexOf(port), 1);
			break;

		case sse.STOP:
			// service stopped - close all connections
			clientPorts.forEach(function dispatchData(clientConnection, index) {
				if (!clientConnection) {
					// WORKER CONNECTION LOST
					// HTTP CONNECTION CLOSED BY CLIENT ?
					clientPorts.splice(index, 1);
					return;
				}
				clientConnection.postMessage({
					type: sse.STOP
				});
				clientPorts.splice(index, 1);
				clientConnection.close();
			});
			portsMap = {
			    session: {},
			    user: {}
			};
			break;

		default:
			console.warning('unexpected message', data);

		}
	};
};
