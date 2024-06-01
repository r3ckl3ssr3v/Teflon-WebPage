(function() {
    "use strict";

    // Function to observe performance metrics
    function observePerformance(type, callback) {
        var observer = new PerformanceObserver(function(list) {
            var entries = list.getEntries();
            for (var i = 0; i < entries.length; i++) {
                callback(entries[i]);
            }
        });
        observer.observe({ type: type, buffered: true });
        return function() {
            if (observer) {
                observer.disconnect();
                observer = null;
            }
        };
    }

    var layoutShiftObserver, largestContentfulPaintObserver, elementTimingObserver, markObserver, measureObserver;

    // Callback to handle layout shifts
    function handleLayoutShift() {
        if (layoutShiftObserver) {
            layoutShiftObserver();
        }
    }

    // Callback to handle largest contentful paint
    function handleLargestContentfulPaint() {
        if (largestContentfulPaintObserver) {
            largestContentfulPaintObserver();
        }
    }

    // Callback to handle element timing
    function handleElementTiming() {
        if (elementTimingObserver) {
            elementTimingObserver();
        }
    }

    // Utility function to access nested properties
    function getNestedProperty(obj, keys) {
        for (var i = 0; i < keys.length; i++) {
            obj = obj ? obj[keys[i]] : undefined;
        }
        return obj;
    }

    // Utility function to parse JSON safely
    function parseJSONSafely(json) {
        var parsed;
        if (json) {
            try {
                parsed = JSON.parse(json);
                var result = {};
                for (var key in parsed) {
                    if (typeof parsed[key] === 'string') {
                        result[key] = parsed[key];
                    }
                }
                return Object.keys(result).length ? JSON.stringify(result) : undefined;
            } catch (e) {}
        }
        return parsed;
    }

    // Function to get data attribute value
    function getDataAttribute(attribute, context, defaultValue) {
        return getNestedProperty(context.t, ["dataset", attribute]) || defaultValue;
    }

    // Function to split attribute value into array
    function splitAttributeValue(attribute, context) {
        attribute = getDataAttribute(attribute, context, "") || [];
        return typeof attribute === 'string' ? attribute.split(",") : attribute;
    }

    var customMarks = {}, customMeasures = {};

    // Function to check if entry name matches prefix
    function matchesPrefix(entryName, fullName, prefixes) {
        return prefixes.some(function(prefix) {
            return entryName.indexOf(prefix) === 0 || fullName.indexOf(prefix) === 0;
        });
    }

    // Function to handle custom performance entries
    function handlePerformanceEntries(context, prefixes) {
        return function(entry) {
            var name = entry.name.replace(/^\d/, "_").replace(/\W/g, "_");
            if (entry.entryType === "mark") {
                if (matchesPrefix(name, entry.name, prefixes.o)) {
                    customMarks[name] = Math.round(entry.startTime) || 0;
                }
            } else if (entry.entryType === "measure") {
                if (matchesPrefix(name, entry.name, prefixes.i)) {
                    customMeasures[name] = Math.round(entry.duration) || 0;
                }
            }
            context.custom_marks = JSON.stringify(customMarks);
            context.custom_measures = JSON.stringify(customMeasures);
        };
    }

    // Function to stop all observers
    function stopAllObservers() {
        if (markObserver) markObserver();
        if (measureObserver) measureObserver();
    }

    // Initialize performance tracking
    function initializePerformanceTracking(context, config) {
        var performanceData = context;

        // Layout Shift tracking
        if (window.LayoutShift) {
            try {
                var layoutShiftCumulative = 0;
                layoutShiftObserver = observePerformance("layout-shift", function(entry) {
                    layoutShiftCumulative += entry.hadRecentInput ? 0 : entry.value;
                    performanceData.cumulative_layout_shift = Math.round(layoutShiftCumulative * 1000) / 1000;
                });
                performanceData.cumulative_layout_shift = Math.round(layoutShiftCumulative * 1000) / 1000;
            } catch (e) {
                handleLayoutShift();
            }
        }

        // Largest Contentful Paint tracking
        if (window.LargestContentfulPaint) {
            try {
                largestContentfulPaintObserver = observePerformance("largest-contentful-paint", function(entry) {
                    performanceData.largest_contentful_paint = Math.round(entry.startTime);
                });
            } catch (e) {
                handleLargestContentfulPaint();
            }
        }

        // Element Timing tracking
        if (window.PerformanceElementTiming) {
            try {
                var element = document.querySelector("[data-bilmur-mie]");
                if (element && element.hasAttribute("elementtiming")) {
                    elementTimingObserver = observePerformance("element", function(entry) {
                        if (entry.element === element) {
                            performanceData.mie_renderTime = Math.round(entry.renderTime);
                            handleElementTiming();
                        }
                    });
                }
            } catch (e) {
                handleElementTiming();
            }
        }

        // Custom Marks and Measures tracking
        if (window.PerformanceMeasure && window.PerformanceMark) {
            config.i = splitAttributeValue("customMeasuresPrefixes", config);
            config.o = splitAttributeValue("customMarksPrefixes", config);
            var performanceHandler = handlePerformanceEntries(performanceData, config);

            try {
                markObserver = observePerformance("mark", performanceHandler);
                measureObserver = observePerformance("measure", performanceHandler);
            } catch (e) {
                stopAllObservers();
            }
        }
    }

    // Function to set provider and service data
    function setProviderAndServiceData(data, context) {
        data.provider = getDataAttribute("provider", context);
        data.service = getDataAttribute("service", context);
        data.custom_properties = parseJSONSafely(getNestedProperty(context.t, ["dataset", "customproperties"]));
    }

    // Check if a value is valid number
    function isValidNumber(value) {
        return value > 0 || value === 0;
    }

    // Function to set navigation timing data
    function setNavigationTimingData(data) {
        var timing = getNestedProperty(performance, ["timing"]) || {};
        if (timing.navigationStart) {
            var apiLevel = (performance.getEntriesByType("navigation")[0] || {}).startTime === 0 ? 2 : 1;
            [
                "unloadEventStart", "unloadEventEnd", "redirectStart", "redirectEnd", "fetchStart",
                "domainLookupStart", "domainLookupEnd", "connectStart", "connectEnd", "secureConnectionStart",
                "requestStart", "responseStart", "responseEnd", "domLoading", "domInteractive",
                "domContentLoadedEventStart", "domContentLoadedEventEnd", "domComplete", "loadEventStart", "loadEventEnd"
            ].forEach(function(event) {
                var value = timing[event];
                data["nt_" + event] = typeof value === 'number' && typeof timing.navigationStart === 'number' && value > 0 && timing.navigationStart > 0 && (value = value - timing.navigationStart) >= 0 ? value : undefined;
            });
            if (apiLevel === 2 && typeof timing.secureConnectionStart === 'number' && timing.secureConnectionStart > 0) {
                data.nt_secureConnectionStart = Math.floor(timing.secureConnectionStart);
            }
            data.nt_redirectCount = timing.redirectCount;
            data.nt_nextHopProtocol = timing.nextHopProtocol;
            data.nt_api_level = apiLevel;
        }
    }

    // Function to set resource timing data
    function setResourceTimingData(data, config) {
        function accumulateSize(entry, accumulator) {
            var transferSize = entry.transferSize;
            var encodedBodySize = entry.encodedBodySize;
            var decodedBodySize = entry.decodedBodySize;
            accumulator.u += decodedBodySize || 0;
            if (entry.deliveryType === "cache" || entry.duration === 0 || encodedBodySize > 0 && transferSize > 0 && transferSize < encodedBodySize || transferSize <= 0 && (decodedBodySize > 0 || entry.duration < 30)) {
                accumulator.m += decodedBodySize || 0;
            } else {
                accumulator.v += transferSize || 0;
            }
        }

        function setResourceData(accumulator) {
            data[accumulator.h + "_size"] = accumulator.u;
            data[accumulator.h + "_transferred"] = accumulator.v;
            if (accumulator.u > 0) {
                data[accumulator.h + "_cache_percent"] = Math.floor(accumulator.m / accumulator.u * 100);
            }
        }

        if (data.nt_domContentLoadedEventStart) {
            var resources = performance.getEntriesByType("resource") || [];
            var resourceAccumulator = { h: "resource", v: 0, u: 0, m: 0 };
            var jsAccumulator = { h: "js", v: 0, u: 0, m: 0 };
            var blockingAccumulator = { h: "blocking", v: 0, u: 0, m: 0 };

            for (var i = 0; i < resources.length; i++) {
                if (resources[i].responseEnd < data.nt_domContentLoadedEventStart) {
                    accumulateSize(resources[i], resourceAccumulator);
                    if (resources[i].initiatorType === "script") {
                        accumulateSize(resources[i], jsAccumulator);
                    }
                    if (resources[i].renderBlockingStatus === "blocking") {
                        accumulateSize(resources[i], blockingAccumulator);
                    }
                }
            }

            setResourceData(resourceAccumulator);
            setResourceData(jsAccumulator);
            setResourceData(blockingAccumulator);

            if (config.p) {
                data.last_resource_end = resources.reduce(function(max, entry) {
                    return Math.max(max, Math.round(entry.responseEnd));
                }, 0);
            }
        }
    }

    // Function to set connection and navigation data
    function setConnectionAndNavigationData(data, config) {
        var effectiveType = getNestedProperty(navigator, ["connection", "effectiveType"]);
        if (effectiveType) {
            data.effective_connection_type = effectiveType;
        }
        var rtt = getNestedProperty(navigator, ["connection", "rtt"]);
        if (isValidNumber(rtt)) {
            data.rtt = rtt;
        }
        var downlink = getNestedProperty(navigator, ["connection", "downlink"]);
        if (isValidNumber(downlink)) {
            data.downlink = Math.round(downlink * 1000);
        }
        data.host_name = getNestedProperty(location, ["hostname"]);
        data.url_path = getNestedProperty(location, ["pathname"]);

        setNavigationTimingData(data);

        var paints = performance.getEntriesByType("paint") || [];
        for (var i = 0; i < paints.length; i++) {
            if (paints[i].name === "first-paint") {
                data.start_render = Math.round(paints[i].startTime);
            } else if (paints[i].name === "first-contentful-paint") {
                data.first_contentful_paint = Math.round(paints[i].startTime);
            }
        }

        setResourceTimingData(data, config);
    }

    var sendInterval = 2000;
    var isSent = false;
    var performanceData = {};

    // Function to send performance data
    function sendPerformanceData(config) {
        config = config || {};
        if (config.l) {
            isSent = true;
        }
        handleLayoutShift();
        handleLargestContentfulPaint();
        handleElementTiming();
        stopAllObservers();

        if (!isSent && document.readyState !== "loading") {
            isSent = true;
            setConnectionAndNavigationData(performanceData, config);
            sendToServer(performanceData);
        }
    }

    var sendToServer = function(data) {
        var queryString = "";
        for (var key in data) {
            if (data[key] !== undefined) {
                queryString += "&" + key + "=" + encodeURIComponent(data[key]);
            }
        }
        if (queryString) {
            (new Image()).src = "https://pixel.wp.com/boom.gif?bilmur=1" + queryString;
        }
    };

    if (window.performance && window.performance.getEntriesByType) {
        var config = {};
        var allowIframe = getDataAttribute("allowIframe", config) === "true";
        try {
            if (window.self !== window.top && !allowIframe) {
                return;
            }
        } catch (e) {
            if (!allowIframe) {
                return;
            }
        }

        initializePerformanceTracking(performanceData, config);

        if (document.visibilityState === "hidden") {
            config.l = true;
            sendPerformanceData(config);
        } else {
            var visibilityChangeHandler = function() {
                if (document.visibilityState === "hidden") {
                    document.removeEventListener("visibilitychange", visibilityChangeHandler);
                    config.l = false;
                    sendPerformanceData(config);
                }
            };
            document.addEventListener("visibilitychange", visibilityChangeHandler);
        }

        var loadHandler = function() {
            setTimeout(sendPerformanceData, sendInterval);
        };

        if (document.readyState === "complete") {
            setTimeout(loadHandler, sendInterval);
        } else {
            addEventListener("load", function() {
                setTimeout(loadHandler, sendInterval);
            });
        }

        function sendPerformanceDataPeriodically() {
            var maxResponseEnd = performance.getEntriesByType("resource").reduce(function(max, entry) {
                return Math.max(max, entry.responseEnd);
            }, 0);
            var timeSinceLastResource = Math.floor(performance.now()) - Math.floor(maxResponseEnd);
            if (sendInterval < timeSinceLastResource) {
                config.p = true;
                sendPerformanceData(config);
            } else {
                setTimeout(sendPerformanceDataPeriodically, timeSinceLastResource <= 0.75 * sendInterval ? 0.05 * sendInterval : 0.25 * sendInterval);
            }
        }

        sendPerformanceDataPeriodically();
    }
})();
