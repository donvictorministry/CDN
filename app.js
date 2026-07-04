           
const SoulWinnerTelemetry = (function () {
    'use strict';
    
    const CONFIG = {
        GAS_ENDPOINT: 'https://script.google.com/macros/s/AKfycbxkjrJRoxUfchfEovMr_aK0dwIAiGwUvjaMavF1fUogWsFYn4eXXCHdFKdRXp9wUyg/exec',
        DB_NAME: 'SoulWinnerTelemetryDB',
        DB_VERSION: 1,
        STORE_NAME: 'telemetry_queue',
        BATCH_SIZE: 15,
        SYNC_INTERVAL_MS: 10000,
        API_TIMEOUT_MS: 3000, 
        SESSION_TIMEOUT_MINUTES: 30
    };

    let cachedLocation = null;
    let sessionStartTime = new Date().getTime();
    const IdentityManager = {
        generateUUID: function () {
            let d = new Date().getTime();
            let d2 = (typeof performance !== 'undefined' && performance.now && (performance.now() * 1000)) || 0;
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                let r = Math.random() * 16;
                if (d > 0) {
                    r = (d + r) % 16 | 0;
                    d = Math.floor(d / 16);
                } else {
                    r = (d2 + r) % 16 | 0;
                    d2 = Math.floor(d2 / 16);
                }
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
        },

        getDeviceID: function () {
            let deviceId = localStorage.getItem('sw_device_id');
            if (!deviceId) {
                deviceId = 'DEV_' + this.generateUUID();
                localStorage.setItem('sw_device_id', deviceId);
            }
            return deviceId;
        },

        getUserID: function () {
            let userId = localStorage.getItem('sw_user_id');
            if (!userId) {
                userId = 'USR_' + this.generateUUID();
                localStorage.setItem('sw_user_id', userId);
            }
            return userId;
        },
        getSessionID: function () {
            const now = new Date().getTime();
            let sessionData = JSON.parse(localStorage.getItem('sw_session') || 'null');

            if (!sessionData || (now - sessionData.lastActive > (CONFIG.SESSION_TIMEOUT_MINUTES * 60 * 1000))) {
                sessionData = {
                    id: 'SESS_' + this.generateUUID(),
                    created: now,
                    lastActive: now
                };
            } else {
                sessionData.lastActive = now;
            }
            localStorage.setItem('sw_session', JSON.stringify(sessionData));
            return sessionData.id;
        }
    };
    const StorageManager = {
        db: null,

        init: function () {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

                request.onupgradeneeded = function (event) {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
                        db.createObjectStore(CONFIG.STORE_NAME, { keyPath: 'id', autoIncrement: true });
                    }
                };

                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    resolve();
                };

                request.onerror = (event) => {
                    console.error('Telemetry DB Initialization Error', event.target.error);
                    reject(event.target.error);
                };
            });
        },
        enqueue: function (payload) {
            return new Promise((resolve, reject) => {
                if (!this.db) return reject(new Error('Database not initialized'));
                const transaction = this.db.transaction([CONFIG.STORE_NAME], 'readwrite');
                const store = transaction.objectStore(CONFIG.STORE_NAME);
                const request = store.add(payload);

                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
        },

        getBatch: function () {
            return new Promise((resolve, reject) => {
                if (!this.db) return resolve([]);
                const transaction = this.db.transaction([CONFIG.STORE_NAME], 'readonly');
                const store = transaction.objectStore(CONFIG.STORE_NAME);
                const request = store.getAll();

                request.onsuccess = (event) => {
                    const allData = event.target.result || [];
                    resolve(allData.slice(0, CONFIG.BATCH_SIZE));
                };
                request.onerror = (e) => reject(e.target.error);
            });
        },

        deleteBatch: function (ids) {
            return new Promise((resolve, reject) => {
                if (!this.db || ids.length === 0) return resolve();
                const transaction = this.db.transaction([CONFIG.STORE_NAME], 'readwrite');
                const store = transaction.objectStore(CONFIG.STORE_NAME);

                ids.forEach(id => store.delete(id));

                transaction.oncomplete = () => resolve();
                transaction.onerror = (e) => reject(e.target.error);
            });
        }
    };
    const DeviceProfiler = {
        getProfile: function () {
            const ua = navigator.userAgent;
            const referrer = document.referrer || '';
            const url = window.location.href;

            let os = 'Unknown';
            if (ua.indexOf('Win') !== -1) os = 'Windows';
            if (ua.indexOf('Mac') !== -1) os = 'MacOS';
            if (ua.indexOf('X11') !== -1) os = 'UNIX';
            if (ua.indexOf('Linux') !== -1) os = 'Linux';
            if (/Android/.test(ua)) os = 'Android';
            if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';

            const isFacebook = ua.includes('FBAN') || ua.includes('FBAV') || referrer.includes('facebook.com');
            const isWhatsApp = ua.includes('WhatsApp') || referrer.includes('wa.me');
            const isTwitter = ua.includes('Twitter') || referrer.includes('t.co');
            const isLinkedIn = ua.includes('LinkedIn') || referrer.includes('linkedin.com');
            const isBlogger = referrer.includes('blogspot.com') || referrer.includes('blogger.com');
            const isGoogle = referrer.includes('google.com') || referrer.includes('android-app://com.google.android.googlequicksearchbox');

            const isChrome = ua.includes('Chrome') && !ua.includes('Edg') && !ua.includes('OPR');
            const isSafari = ua.includes('Safari') && !ua.includes('Chrome');
            const isBrave = (navigator.brave && navigator.brave.isBrave) ? true : false;

            const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            const connectionType = connection ? connection.effectiveType : 'Unknown';

            return {
                UserAgent: ua,
                ReferrerHeader: referrer,
                RequestURL: url,
                ScreenResolution: `${window.screen.width || 0}x${window.screen.height || 0}`,
                DeviceOS: os,
                ConnectionType: connectionType,
                Facebook: isFacebook ? 'Yes' : 'No',
                WhatsApp: isWhatsApp ? 'Yes' : 'No',
                Twitter: isTwitter ? 'Yes' : 'No',
                LinkedIn: isLinkedIn ? 'Yes' : 'No',
                Blogger: isBlogger ? 'Yes' : 'No',
                Google: isGoogle ? 'Yes' : 'No',
                Chrome: isChrome ? 'Yes' : 'No',
                Safari: isSafari ? 'Yes' : 'No',
                Brave: isBrave ? 'Yes' : 'No'
            };
        }
    };

    const GeoLocator = {
        fetchWithTimeout: function (url, options = {}) {
            return Promise.race([
                fetch(url, options),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), CONFIG.API_TIMEOUT_MS))
            ]);
        },
        getLocation: async function () {
            if (cachedLocation) return cachedLocation;

            const fallbackLoc = { Country: 'Unknown', City: 'Unknown', ISP: 'Unknown', MobileNetwork: 'Unknown' };

            const apis = [
                {
                    url: 'https://ipapi.co/json/',
                    parse: (data) => ({ Country: data.country_name, City: data.city, ISP: data.org, MobileNetwork: data.org })
                },
                {
                    url: 'https://ipwho.is/',
                    parse: (data) => ({ Country: data.country, City: data.city, ISP: data.connection.isp, MobileNetwork: data.connection.isp })
                },
                {
                    url: 'https://ipinfo.io/json',
                    parse: (data) => ({ Country: data.country, City: data.city, ISP: data.org, MobileNetwork: data.org })
                },
                {
                    url: 'https://freeipapi.com/api/json',
                    parse: (data) => ({ Country: data.countryName, City: data.cityName, ISP: 'Unknown', MobileNetwork: 'Unknown' })
                },
                {
                    url: 'https://api.bigdatacloud.net/data/client-info',
                    parse: (data) => ({ Country: data.countryName, City: data.city, ISP: 'Unknown', MobileNetwork: 'Unknown' })
                }
            ];

            for (const api of apis) {
                try {
                    const response = await this.fetchWithTimeout(api.url);
                    if (!response.ok) continue;
                    const data = await response.json();
                    
                    const parsed = api.parse(data);
                    if (parsed.Country && parsed.Country !== 'Unknown') {
                        cachedLocation = parsed;
                        return cachedLocation;
                    }
                } catch (error) {
                    // Fail silently and cascade to the next fallback API layer
                    continue;
                }
            }

            return fallbackLoc;
        }
    };
    const Monitor = {
        getPerformanceMetrics: function () {
            let loadTimeMs = 0;
            let networkLatencyMs = 0;

            if (window.performance && window.performance.timing) {
                const t = window.performance.timing;
                loadTimeMs = t.loadEventEnd > 0 ? (t.loadEventEnd - t.navigationStart) : (new Date().getTime() - t.navigationStart);
                networkLatencyMs = t.responseEnd - t.requestStart;
            }

            return {
                LoadTimeMs: loadTimeMs > 0 ? loadTimeMs : 0,
                NetworkLatencyMs: networkLatencyMs > 0 ? networkLatencyMs : 0,
                OfflineFlag: !navigator.onLine ? 'Yes' : 'No'
            };
        },

        initCrashHandler: function () {
            window.addEventListener('error', (event) => {
                TelemetryEngine.logCrash({
                    CrashType: 'JavaScript Error',
                    CrashMessage: event.message,
                    StackTrace: event.error ? event.error.stack : 'N/A',
                    ThreadName: 'Main'
                });
            });

            window.addEventListener('unhandledrejection', (event) => {
                TelemetryEngine.logCrash({
                    CrashType: 'Unhandled Promise Rejection',
                    CrashMessage: event.reason ? event.reason.toString() : 'Unknown Reason',
                    StackTrace: event.reason && event.reason.stack ? event.reason.stack : 'N/A',
                    ThreadName: 'Async'
                });
            });
        }
    };

    const AutoTracker = {
        init: function() {
            this.bindClickTracking();
            this.bindFormTracking();
            this.bindVisibilityTracking();
            this.bindRouteTracking();
        },
        
        bindClickTracking: function() {
            document.body.addEventListener('click', (e) => {
                const target = e.target.closest('button, a, [role="button"], input[type="submit"], input[type="button"], .clickable');
                if (!target) return; // Ignore clicks on blank space or static text

                let textId = target.innerText || target.value || target.getAttribute('aria-label') || target.id || target.className || 'Unknown_Element';
                textId = textId.replace(/[\n\r]+/g, ' ').substring(0, 50).trim();

                let eventType = 'Click_Button';
                if (target.tagName.toLowerCase() === 'a') eventType = 'Click_Link';
  
                TelemetryEngine.logInteraction(eventType, textId, 0, 'AutoTracker_DOM');
            }, { passive: true });
        },

        bindFormTracking: function() {
            document.body.addEventListener('submit', (e) => {
                const form = e.target;
                const formId = form.id || form.name || form.className || 'Unnamed_Form';
                
                TelemetryEngine.logInteraction('Form_Submit', formId, 0, 'AutoTracker_DOM');
            }, { passive: true });
        },

        bindVisibilityTracking: function() {
            window.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    const timeSpentMs = new Date().getTime() - sessionStartTime;
                    TelemetryEngine.logAnalytics('Session_Hidden', timeSpentMs);
                } else if (document.visibilityState === 'visible') {
                    sessionStartTime = new Date().getTime();
                }
            });
            window.addEventListener('beforeunload', () => {
                const timeSpentMs = new Date().getTime() - sessionStartTime;
                TelemetryEngine.logAnalytics('Session_Exit', timeSpentMs);
            });
        },

        bindRouteTracking: function() {
            let lastUrl = location.href;
            
            const trackView = () => {
                const currentUrl = location.href;
                if (currentUrl !== lastUrl) {
                    TelemetryEngine.logInteraction('Virtual_Page_View', currentUrl.substring(0, 100), 0, 'AutoTracker_Router');
                    lastUrl = currentUrl;
                }
            };

            window.addEventListener('popstate', trackView);
            const originalPushState = history.pushState;
            history.pushState = function() {
                originalPushState.apply(this, arguments);
                trackView();
            };
            const originalReplaceState = history.replaceState;
            history.replaceState = function() {
                originalReplaceState.apply(this, arguments);
                trackView();
            };
        }
    };

    const TelemetryEngine = {
        buildCorePayload: async function (specificData) {
            const loc = await GeoLocator.getLocation();
            
            const core = {
                Timestamp: new Date().toISOString(),
                UserID: IdentityManager.getUserID(),
                Country: loc.Country,
                City: loc.City,
                ISP: loc.ISP,
                MobileNetwork: loc.MobileNetwork
            };

            return Object.assign({}, core, specificData);
        },

        queueEvent: async function (actionName, payload) {
            try {
                const fullPayload = await this.buildCorePayload(payload);
                await StorageManager.enqueue({
                    action: actionName,
                    data: fullPayload
                });
            } catch (error) {
                console.error('Failed to queue telemetry event:', error);
            }
        },
        logTraffic: function () {
            const profile = DeviceProfiler.getProfile();
            profile.DeviceID = IdentityManager.getDeviceID();
            this.queueEvent('log_traffic', profile);
        },

        logInteraction: function (eventType, detail, payloadSize = 0, destination = 'Local') {
            this.queueEvent('log_interaction', {
                SessionID: IdentityManager.getSessionID(),
                EventType: eventType,
                Share: eventType.includes('Share') ? 'Yes' : 'No',
                EventDetail: detail,
                InteractionDurationMs: 0,
                PayloadSize: payloadSize,
                StatusCode: '200',
                RetryCount: 0,
                DestinationPlatform: destination
            });
        },

        logAnalytics: function (actionTaken, timeSpentMs = 0) {
            const perf = Monitor.getPerformanceMetrics();
            const profile = DeviceProfiler.getProfile();

            this.queueEvent('log_analytics', {
                UserAgent: profile.UserAgent,
                VisitedDate: new Date().toISOString().split('T')[0],
                TimeSpent: timeSpentMs,
                ActionTaken: actionTaken,
                SessionID: IdentityManager.getSessionID(),
                PageDepth: window.history.length,
                BounceFlag: timeSpentMs < 5000 && timeSpentMs > 0 ? 'Yes' : 'No',
                EntryPage: profile.RequestURL,
                ExitPage: profile.RequestURL,
                LoadTimeMs: perf.LoadTimeMs,
                NetworkLatencyMs: perf.NetworkLatencyMs,
                OfflineFlag: perf.OfflineFlag
            });
        },

        logCrash: function (crashData) {
            const profile = DeviceProfiler.getProfile();
            const memory = (performance && performance.memory) ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0;
            
            const payload = Object.assign({
                CrashID: 'CRSH_' + IdentityManager.generateUUID(),
                DeviceID: IdentityManager.getDeviceID(),
                DeviceOS: profile.DeviceOS,
                OSVersion: 'Unknown',
                AppVersion: '1.0',
                MemoryUsageMB: memory,
                BatteryLevel: 'Unknown', 
                ScreenOrientation: (window.screen && window.screen.orientation) ? window.screen.orientation.type : 'Unknown'
            }, crashData);

            this.queueEvent('log_crash', payload);
        }
    };

    const Dispatcher = {
        isSyncing: false,
        sync: async function () {
            if (this.isSyncing || !navigator.onLine) return;
            
            try {
                this.isSyncing = true;
                const batch = await StorageManager.getBatch();
                
                if (batch.length === 0) {
                    this.isSyncing = false;
                    return;
                }
                const actionGroups = {};
                batch.forEach(item => {
                    if (!actionGroups[item.action]) actionGroups[item.action] = [];
                    actionGroups[item.action].push({ id: item.id, data: item.data });
                });

                const successfulIds = [];

                for (const ObjectEntry of Object.entries(actionGroups)) {
                    const action = ObjectEntry[0];
                    const items = ObjectEntry[1];
                    const payloadData = items.map(i => i.data);
                    
                    await fetch(CONFIG.GAS_ENDPOINT, {
                        method: 'POST',
                        mode: 'no-cors', 
                        headers: {
                            'Content-Type': 'text/plain'
                        },
                        body: JSON.stringify({
                            action: action,
                            data: payloadData
                        })
                    });

                    // Due to opaque no-cors responses, we assume safe transit if network layer didn't throw
                    successfulIds.push(...items.map(i => i.id));
                }

                if (successfulIds.length > 0) {
                    await StorageManager.deleteBatch(successfulIds);
                }

            } catch (error) {
                console.error('Telemetry Synchronization Failure:', error);
            } finally {
                this.isSyncing = false;
            }
        },

        startDaemon: function () {
            setInterval(() => this.sync(), CONFIG.SYNC_INTERVAL_MS);
            window.addEventListener('online', () => this.sync());
        }
    };
    return {
        init: async function () {
            if (CONFIG.GAS_ENDPOINT === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
                console.warn("SoulWinner Telemetry: Missing GAS Endpoint URL configuration.");
                return; // Graceful halt if unconfigured
            }

            try {
                await StorageManager.init();
                Monitor.initCrashHandler();
                AutoTracker.init();
                Dispatcher.startDaemon();
                window.addEventListener('load', () => {
                    setTimeout(() => {
                        TelemetryEngine.logTraffic();
                        TelemetryEngine.logAnalytics('Initial_PageLoad');
                    }, 2000);
                });

            } catch (e) {
                console.error("Telemetry Initialization Architecture Failed:", e);
            }
        },

        trackInteraction: function (eventType, detail) {
            TelemetryEngine.logInteraction(eventType, detail, 0, 'Manual_Trigger');
        },
        trackShare: function (platform, detail) {
            TelemetryEngine.logInteraction('Explicit_Share', detail, 0, platform);
        }
    };

})();

SoulWinnerTelemetry.init();
</script>


<script>
const SoulWinnerTelemetry = (function () {
    'use strict';
    
    const CONFIG = {
        GAS_ENDPOINT: 'https://script.google.com/macros/s/AKfycbxkjrJRoxUfchfEovMr_aK0dwIAiGwUvjaMavF1fUogWsFYn4eXXCHdFKdRXp9wUyg/exec',
        DB_NAME: 'SoulWinnerTelemetryDB',
        DB_VERSION: 1
        STORE_NAME: 'telemetry_queue',
        BATCH_SIZE: 100,
        SYNC_INTERVAL_MS: 600000,
        API_TIMEOUT_MS: 3000, 
        SESSION_TIMEOUT_MINUTES: 30
    };

    let cachedLocation = null;
    let sessionStartTime = new Date().getTime();
    const IdentityManager = {
        generateUUID: function () {
            let d = new Date().getTime();
            let d2 = (typeof performance !== 'undefined' && performance.now && (performance.now() * 1000)) || 0;
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                let r = Math.random() * 16;
                if (d > 0) {
                    r = (d + r) % 16 | 0;
                    d = Math.floor(d / 16);
                } else {
                    r = (d2 + r) % 16 | 0;
                    d2 = Math.floor(d2 / 16);
                }
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
        },

        getDeviceID: function () {
            let deviceId = localStorage.getItem('sw_device_id');
            if (!deviceId) {
                deviceId = 'DEV_' + this.generateUUID();
                localStorage.setItem('sw_device_id', deviceId);
            }
            return deviceId;
        },

        getUserID: function () {
            let userId = localStorage.getItem('sw_user_id');
            if (!userId) {
                userId = 'USR_' + this.generateUUID();
                localStorage.setItem('sw_user_id', userId);
            }
            return userId;
        },
        getSessionID: function () {
            const now = new Date().getTime();
            let sessionData = JSON.parse(localStorage.getItem('sw_session') || 'null');

            if (!sessionData || (now - sessionData.lastActive > (CONFIG.SESSION_TIMEOUT_MINUTES * 60 * 1000))) {
                sessionData = {
                    id: 'SESS_' + this.generateUUID(),
                    created: now,
                    lastActive: now
                };
            } else {
                sessionData.lastActive = now;
            }
            localStorage.setItem('sw_session', JSON.stringify(sessionData));
            return sessionData.id;
        }
    };
    const StorageManager = {
        db: null,

        init: function () {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

                request.onupgradeneeded = function (event) {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
                        db.createObjectStore(CONFIG.STORE_NAME, { keyPath: 'id', autoIncrement: true });
                    }
                };

                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    resolve();
                };

                request.onerror = (event) => {
                    console.error('Telemetry DB Initialization Error', event.target.error);
                    reject(event.target.error);
                };
            });
        },
        enqueue: function (payload) {
            return new Promise((resolve, reject) => {
                if (!this.db) return reject(new Error('Database not initialized'));
                const transaction = this.db.transaction([CONFIG.STORE_NAME], 'readwrite');
                const store = transaction.objectStore(CONFIG.STORE_NAME);
                const request = store.add(payload);

                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
        },

        getBatch: function () {
            return new Promise((resolve, reject) => {
                if (!this.db) return resolve([]);
                const transaction = this.db.transaction([CONFIG.STORE_NAME], 'readonly');
                const store = transaction.objectStore(CONFIG.STORE_NAME);
                const request = store.getAll();

                request.onsuccess = (event) => {
                    const allData = event.target.result || [];
                    resolve(allData.slice(0, CONFIG.BATCH_SIZE));
                };
                request.onerror = (e) => reject(e.target.error);
            });
        },

        deleteBatch: function (ids) {
            return new Promise((resolve, reject) => {
                if (!this.db || ids.length === 0) return resolve();
                const transaction = this.db.transaction([CONFIG.STORE_NAME], 'readwrite');
                const store = transaction.objectStore(CONFIG.STORE_NAME);

                ids.forEach(id => store.delete(id));

                transaction.oncomplete = () => resolve();
                transaction.onerror = (e) => reject(e.target.error);
            });
        }
    };
    const DeviceProfiler = {
        getProfile: function () {
            const ua = navigator.userAgent;
            const referrer = document.referrer || '';
            const url = window.location.href;

            let os = 'Unknown';
            if (ua.indexOf('Win') !== -1) os = 'Windows';
            if (ua.indexOf('Mac') !== -1) os = 'MacOS';
            if (ua.indexOf('X11') !== -1) os = 'UNIX';
            if (ua.indexOf('Linux') !== -1) os = 'Linux';
            if (/Android/.test(ua)) os = 'Android';
            if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';

            const isFacebook = ua.includes('FBAN') || ua.includes('FBAV') || referrer.includes('facebook.com');
            const isWhatsApp = ua.includes('WhatsApp') || referrer.includes('wa.me');
            const isTwitter = ua.includes('Twitter') || referrer.includes('t.co');
            const isLinkedIn = ua.includes('LinkedIn') || referrer.includes('linkedin.com');
            const isBlogger = referrer.includes('blogspot.com') || referrer.includes('blogger.com');
            const isGoogle = referrer.includes('google.com') || referrer.includes('android-app://com.google.android.googlequicksearchbox');

            const isChrome = ua.includes('Chrome') && !ua.includes('Edg') && !ua.includes('OPR');
            const isSafari = ua.includes('Safari') && !ua.includes('Chrome');
            const isBrave = (navigator.brave && navigator.brave.isBrave) ? true : false;

            const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            const connectionType = connection ? connection.effectiveType : 'Unknown';

            return {
                UserAgent: ua,
                ReferrerHeader: referrer,
                RequestURL: url,
                ScreenResolution: `${window.screen.width || 0}x${window.screen.height || 0}`,
                DeviceOS: os,
                ConnectionType: connectionType,
                Facebook: isFacebook ? 'Yes' : 'No',
                WhatsApp: isWhatsApp ? 'Yes' : 'No',
                Twitter: isTwitter ? 'Yes' : 'No',
                LinkedIn: isLinkedIn ? 'Yes' : 'No',
                Blogger: isBlogger ? 'Yes' : 'No',
                Google: isGoogle ? 'Yes' : 'No',
                Chrome: isChrome ? 'Yes' : 'No',
                Safari: isSafari ? 'Yes' : 'No',
                Brave: isBrave ? 'Yes' : 'No'
            };
        }
    };

    const GeoLocator = {
        fetchWithTimeout: function (url, options = {}) {
            return Promise.race([
                fetch(url, options),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), CONFIG.API_TIMEOUT_MS))
            ]);
        },
        getLocation: async function () {
            if (cachedLocation) return cachedLocation;

            const fallbackLoc = { Country: 'Unknown', City: 'Unknown', ISP: 'Unknown', MobileNetwork: 'Unknown' };

            const apis = [
                {
                    url: 'https://ipapi.co/json/',
                    parse: (data) => ({ Country: data.country_name, City: data.city, ISP: data.org, MobileNetwork: data.org })
                },
                {
                    url: 'https://ipwho.is/',
                    parse: (data) => ({ Country: data.country, City: data.city, ISP: data.connection.isp, MobileNetwork: data.connection.isp })
                },
                {
                    url: 'https://ipinfo.io/json',
                    parse: (data) => ({ Country: data.country, City: data.city, ISP: data.org, MobileNetwork: data.org })
                },
                {
                    url: 'https://freeipapi.com/api/json',
                    parse: (data) => ({ Country: data.countryName, City: data.cityName, ISP: 'Unknown', MobileNetwork: 'Unknown' })
                },
                {
                    url: 'https://api.bigdatacloud.net/data/client-info',
                    parse: (data) => ({ Country: data.countryName, City: data.city, ISP: 'Unknown', MobileNetwork: 'Unknown' })
                }
            ];

            for (const api of apis) {
                try {
                    const response = await this.fetchWithTimeout(api.url);
                    if (!response.ok) continue;
                    const data = await response.json();
                    
                    const parsed = api.parse(data);
                    if (parsed.Country && parsed.Country !== 'Unknown') {
                        cachedLocation = parsed;
                        return cachedLocation;
                    }
                } catch (error) {
                    continue;
                }
            }
            return fallbackLoc;
        }
    };
    const Monitor = {
        getPerformanceMetrics: function () {
            let loadTimeMs = 0;
            let networkLatencyMs = 0;

            if (window.performance && window.performance.timing) {
                const t = window.performance.timing;
                loadTimeMs = t.loadEventEnd > 0 ? (t.loadEventEnd - t.navigationStart) : (new Date().getTime() - t.navigationStart);
                networkLatencyMs = t.responseEnd - t.requestStart;
            }

            return {
                LoadTimeMs: loadTimeMs > 0 ? loadTimeMs : 0,
                NetworkLatencyMs: networkLatencyMs > 0 ? networkLatencyMs : 0,
                OfflineFlag: !navigator.onLine ? 'Yes' : 'No'
            };
        },

        initCrashHandler: function () {
            window.addEventListener('error', (event) => {
                TelemetryEngine.logCrash({
                    CrashType: 'JavaScript Error',
                    CrashMessage: event.message,
                    StackTrace: event.error ? event.error.stack : 'N/A',
                    ThreadName: 'Main'
                });
            });

            window.addEventListener('unhandledrejection', (event) => {
                TelemetryEngine.logCrash({
                    CrashType: 'Unhandled Promise Rejection',
                    CrashMessage: event.reason ? event.reason.toString() : 'Unknown Reason',
                    StackTrace: event.reason && event.reason.stack ? event.reason.stack : 'N/A',
                    ThreadName: 'Async'
                });
            });
        }
    };

    const AutoTracker = {
        init: function() {
            this.bindClickTracking();
            this.bindFormTracking();
            this.bindVisibilityTracking();
            this.bindRouteTracking();
        },
        
        bindClickTracking: function() {
            document.body.addEventListener('click', (e) => {
                const target = e.target.closest('button, a, [role="button"], input[type="submit"], input[type="button"], .clickable');
                if (!target) return; // Ignore clicks on blank space or static text

                let textId = target.innerText || target.value || target.getAttribute('aria-label') || target.id || target.className || 'Unknown_Element';
                textId = textId.replace(/[\n\r]+/g, ' ').substring(0, 50).trim();

                let eventType = 'Click_Button';
                if (target.tagName.toLowerCase() === 'a') eventType = 'Click_Link';
  
                TelemetryEngine.logInteraction(eventType, textId, 0, 'AutoTracker_DOM');
            }, { passive: true });
        },

        bindFormTracking: function() {
            document.body.addEventListener('submit', (e) => {
                const form = e.target;
                const formId = form.id || form.name || form.className || 'Unnamed_Form';
                
                TelemetryEngine.logInteraction('Form_Submit', formId, 0, 'AutoTracker_DOM');
            }, { passive: true });
        },

        bindVisibilityTracking: function() {
            window.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    const timeSpentMs = new Date().getTime() - sessionStartTime;
                    TelemetryEngine.logAnalytics('Session_Hidden', timeSpentMs);
                } else if (document.visibilityState === 'visible') {
                    sessionStartTime = new Date().getTime();
                }
            });
            window.addEventListener('beforeunload', () => {
                const timeSpentMs = new Date().getTime() - sessionStartTime;
                TelemetryEngine.logAnalytics('Session_Exit', timeSpentMs);
            });
        },

        bindRouteTracking: function() {
            let lastUrl = location.href;
            
            const trackView = () => {
                const currentUrl = location.href;
                if (currentUrl !== lastUrl) {
                    TelemetryEngine.logInteraction('Virtual_Page_View', currentUrl.substring(0, 100), 0, 'AutoTracker_Router');
                    lastUrl = currentUrl;
                }
            };

            window.addEventListener('popstate', trackView);
            const originalPushState = history.pushState;
            history.pushState = function() {
                originalPushState.apply(this, arguments);
                trackView();
            };
            const originalReplaceState = history.replaceState;
            history.replaceState = function() {
                originalReplaceState.apply(this, arguments);
                trackView();
            };
        }
    };

    const TelemetryEngine = {
        buildCorePayload: async function (specificData) {
            const loc = await GeoLocator.getLocation();
            
            const core = {
                Timestamp: new Date().toISOString(),
                UserID: IdentityManager.getUserID(),
                Country: loc.Country,
                City: loc.City,
                ISP: loc.ISP,
                MobileNetwork: loc.MobileNetwork
            };

            return Object.assign({}, core, specificData);
        },

        queueEvent: async function (actionName, payload) {
            try {
                const fullPayload = await this.buildCorePayload(payload);
                await StorageManager.enqueue({
                    action: actionName,
                    data: fullPayload
                });
            } catch (error) {
                console.error('Failed to queue telemetry event:', error);
            }
        },
        logTraffic: function () {
            const profile = DeviceProfiler.getProfile();
            profile.DeviceID = IdentityManager.getDeviceID();
            this.queueEvent('log_traffic', profile);
        },

        logInteraction: function (eventType, detail, payloadSize = 0, destination = 'Local') {
            this.queueEvent('log_interaction', {
                SessionID: IdentityManager.getSessionID(),
                EventType: eventType,
                Share: eventType.includes('Share') ? 'Yes' : 'No',
                EventDetail: detail,
                InteractionDurationMs: 0,
                PayloadSize: payloadSize,
                StatusCode: '200',
                RetryCount: 0,
                DestinationPlatform: destination
            });
        },

        logAnalytics: function (actionTaken, timeSpentMs = 0) {
            const perf = Monitor.getPerformanceMetrics();
            const profile = DeviceProfiler.getProfile();

            this.queueEvent('log_analytics', {
                UserAgent: profile.UserAgent,
                VisitedDate: new Date().toISOString().split('T')[0],
                TimeSpent: timeSpentMs,
                ActionTaken: actionTaken,
                SessionID: IdentityManager.getSessionID(),
                PageDepth: window.history.length,
                BounceFlag: timeSpentMs < 5000 && timeSpentMs > 0 ? 'Yes' : 'No',
                EntryPage: profile.RequestURL,
                ExitPage: profile.RequestURL,
                LoadTimeMs: perf.LoadTimeMs,
                NetworkLatencyMs: perf.NetworkLatencyMs,
                OfflineFlag: perf.OfflineFlag
            });
        },

        logCrash: function (crashData) {
            const profile = DeviceProfiler.getProfile();
            const memory = (performance && performance.memory) ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0;
            
            const payload = Object.assign({
                CrashID: 'CRSH_' + IdentityManager.generateUUID(),
                DeviceID: IdentityManager.getDeviceID(),
                DeviceOS: profile.DeviceOS,
                OSVersion: 'Unknown',
                AppVersion: '1.0',
                MemoryUsageMB: memory,
                BatteryLevel: 'Unknown', 
                ScreenOrientation: (window.screen && window.screen.orientation) ? window.screen.orientation.type : 'Unknown'
            }, crashData);

            this.queueEvent('log_crash', payload);
        }
    };

    const Dispatcher = {
        isSyncing: false,
        sync: async function () {
            if (this.isSyncing || !navigator.onLine) return;
            
            try {
                this.isSyncing = true;
                const batch = await StorageManager.getBatch();
                
                if (batch.length === 0) {
                    this.isSyncing = false;
                    return;
                }
                const actionGroups = {};
                batch.forEach(item => {
                    if (!actionGroups[item.action]) actionGroups[item.action] = [];
                    actionGroups[item.action].push({ id: item.id, data: item.data });
                });
                const successfulIds = [];

                for (const ObjectEntry of Object.entries(actionGroups)) {
                    const action = ObjectEntry[0];
                    const items = ObjectEntry[1];
                    const payloadData = items.map(i => i.data);
                    
                    await fetch(CONFIG.GAS_ENDPOINT, {
                        method: 'POST',
                        mode: 'no-cors', 
                        headers: {
                            'Content-Type': 'text/plain'
                        },
                        body: JSON.stringify({
                            action: action,
                            data: payloadData
                        })
                    });
                    successfulIds.push(...items.map(i => i.id));
                }

                if (successfulIds.length > 0) {
                    await StorageManager.deleteBatch(successfulIds);
                }

            } catch (error) {
                console.error('Telemetry Synchronization Failure:', error);
            } finally {
                this.isSyncing = false;
            }
        },

        startDaemon: function () {
            setInterval(() => this.sync(), CONFIG.SYNC_INTERVAL_MS);
            window.addEventListener('online', () => this.sync());
        }
    };
    return {
        init: async function () {
            if (CONFIG.GAS_ENDPOINT === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
                console.warn("SoulWinner Telemetry: Missing GAS Endpoint URL configuration.");
                return; 
            }

            try {
                await StorageManager.init();
                Monitor.initCrashHandler();
                AutoTracker.init();
                Dispatcher.startDaemon();
                window.addEventListener('load', () => {
                    setTimeout(() => {
                        TelemetryEngine.logTraffic();
                        TelemetryEngine.logAnalytics('Initial_PageLoad');
                    }, 2000);
                });

            } catch (e) {
                console.error("Telemetry Initialization Architecture Failed:", e);
            }
        },

        trackInteraction: function (eventType, detail) {
            TelemetryEngine.logInteraction(eventType, detail, 0, 'Manual_Trigger');
        },
        trackShare: function (platform, detail) {
            TelemetryEngine.logInteraction('Explicit_Share', detail, 0, platform);
        }
    };

})();

SoulWinnerTelemetry.init();                         
