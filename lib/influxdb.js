/*
 * Flush stats to InfluxDB (http://influxdb.org/)
 *
 * To enable this backend, include 'statsd-influxdb-backend' in the backends
 * configuration array:
 *
 *   backends: ['statsd-influxdb-backend']
 *
 * The backend will read the configuration options from the following
 * 'influxdb' hash defined in the main statsd config file:
 *
 * influxdb: {
 *   host: '127.0.0.1',   // InfluxDB host. (default 127.0.0.1)
 *   port: 8086,          // InfluxDB port. (default 8086)
 *   ssl: false,          // InfluxDB is hosted over SSL. (default false)
 *   database: 'dbname',  // InfluxDB database instance. (required)
 *   username: 'user',    // InfluxDB database username. (required)
 *   password: 'pass',    // InfluxDB database password. (required)
 *   flush: {
 *     enable: true       // Enable regular flush strategy. (default true)
 *   },
 *   proxy: {
 *     enable: false,       // Enable the proxy strategy. (default false)
 *     suffix: 'raw',       // Metric name suffix. (default 'raw')
 *     flushInterval: 1000  // Flush interval for the internal buffer.
 *                          // (default 1000)
 *   },
 *   includeStatsdMetrics: false // Send statsd metrics to InfluxDB. (default false)
 * }
 *
 */
var util = require('util'),
    querystring = require('querystring'),
    http = require('http'),
    https = require('https');

function InfluxdbBackend(startupTime, config, events) {
  var self = this;

  self.debug = config.debug;
  self.registry = {};

  self.defaultHost = '127.0.0.1';
  self.defaultPort = 8086;
  self.defaultFlushEnable = true;
  self.defaultProxyEnable = false;
  self.defaultProxySuffix = 'raw';
  self.defaultProxyFlushInterval = 1000;
  self.prefixStats = config.prefixStats !== undefined ? config.prefixStats : "statsd";

  self.host = self.defaultHost;
  self.port = self.defaultPort;
  self.protocol = http;
  self.flushEnable = self.defaultFlushEnable;
  self.proxyEnable = self.defaultProxyEnable;
  self.proxySuffix = self.defaultProxySuffix;
  self.proxyFlushInterval = self.defaultProxyFlushInterval;
  self.includeStatsdMetrics = false;

  if (config.influxdb) {
    self.host = config.influxdb.host || self.defaultHost;
    self.port = config.influxdb.port || self.defaultPort;
    self.user = config.influxdb.username;
    self.pass = config.influxdb.password;
    self.database = config.influxdb.database;
    self.includeStatsdMetrics = config.influxdb.includeStatsdMetrics;

    if (config.influxdb.ssl) {
      self.protocol = https;
    }

    if (config.influxdb.flush) {
      self.flushEnable = config.influxdb.flush.enable;
    }

    if (config.influxdb.proxy) {
      self.proxyEnable = config.influxdb.proxy.enable || self.defaultProxyEnable;
      self.proxySuffix = config.influxdb.proxy.suffix || self.defaultProxySuffix;
      self.proxyFlushInterval = config.influxdb.proxy.flushInterval || self.defaultProxyFlushInterval;
    }
  }

  if (self.proxyEnable) {
    self.log('Starting the buffer flush interval. (every ' + self.proxyFlushInterval + 'ms)');
    setInterval(function () {
      self.flushQueue();
    }, self.proxyFlushInterval);

    events.on('packet', function (packet, rinfo) {
      try {
        self.processPacket(packet, rinfo);
      } catch (e) {
        self.log(e);
      }
    });
  }

  if (self.flushEnable) {
    events.on('flush', function (timestamp, metrics) {
      try {
        self.processFlush(timestamp, metrics);
      } catch (e) {
        self.log(e);
      }
    });
  }

  return true;
}

InfluxdbBackend.prototype.log = function (msg) {
  util.log('[influxdb] ' + msg);
}

InfluxdbBackend.prototype.logDebug = function (msg) {
  if (this.debug) {
    var string;

    if (msg instanceof Function) {
      string = msg();
    } else {
      string = msg;
    }

    util.log('[influxdb] (DEBUG) ' + string);
  }
}

/**
 * Flush strategy handler
 *
 * @param {Number} timestamp
 * @param {Object} stats metric
 */
InfluxdbBackend.prototype.processFlush = function (timestamp, metrics) {
  var self = this,
      counters = metrics.counters,
      gauges = metrics.gauges,
      timerData = metrics.timer_data,
      statsdMetrics = metrics.statsd_metrics,
      points = [],
      sets  = function (vals) {
        var ret = {};
        for (var val in vals) {
          ret[val] = vals[val].values();
        }
        return ret;
      }(metrics.sets),
      statsdMetricsRegExp = new RegExp('^'+self.prefixStats),
      key, timerKey;

  /* Convert timestamp from seconds to milliseconds. */
  timestamp = (timestamp * 1000);

  for (key in counters) {
    /* Do not include statsd counters. */
    if (!self.includeStatsdMetrics && key.match(statsdMetricsRegExp)) { continue; }

    var value = counters[key],
        k = key + '.counter';

    if (value) {
      points.push(self.assembleEvent(k, [{value: value, time: timestamp}]));
    }
  }

  for (set in sets) {
    sets[set].map(function (v) {
      points.push(self.assembleEvent(set, [{value: v, time: timestamp}]));
    })
    points.push(self.assembleEvent(set + "_count", [{value: sets[set].length, time: timestamp}]));
  }

  for (key in gauges) {
    var value = gauges[key],
        k = key + '.gauge';

    if (!isNaN(parseFloat(value)) && isFinite(value)) {
      points.push(self.assembleEvent(k, [{value: value, time: timestamp}]));
    }
  }

  for (key in timerData) {
    var timerMetrics = timerData[key];

    // Try to add histogram data, if it is there:
    if (timerMetrics.histogram) {
      var histoMetrics = timerMetrics.histogram
        , histoKey;

      for (histoKey in histoMetrics) {
        var value = histoMetrics[histoKey],
          k = key + '.timer.histogram.' + histoKey;

        points.push(self.assembleEvent(k, [{value: value, time: timestamp}]));
      }

      // Delete here so it isn't iterated over later:
      delete timerMetrics.histogram;
    }

    // Iterate over normal metrics:
    for (timerKey in timerMetrics) {
      var value = timerMetrics[timerKey],
          k = key + '.timer' + '.' + timerKey;

      points.push(self.assembleEvent(k, [{value: value, time: timestamp}]));
    }
  }

  if (self.includeStatsdMetrics) {
    for (key in statsdMetrics) {
      var value = statsdMetrics[key],
          k = prefixStats + '.' + key;

      if (!isNaN(parseFloat(value)) && isFinite(value)) {
        points.push(self.assembleEvent(k, [{value: value, time: timestamp}]));
      }
    }
  }

  self.httpPOST(points);
}

InfluxdbBackend.prototype.processPacket = function (packet, rinfo) {
  var self = this,
      ts = (new Date()).valueOf();

  /* Stolen from statsd's stats.js. */
  var packet_data = packet.toString(),
      metrics;

  if (packet_data.indexOf("\n") > -1) {
    metrics = packet_data.split("\n");
  } else {
    metrics = [packet_data];
  }

  for (var midx in metrics) {
    if (metrics[midx].length === 0) {
      continue;
    }
    var bits = metrics[midx].toString().split(':');
    var key = bits.shift()
                  .replace(/\s+/g, '_')
                  .replace(/\//g, '-')
                  .replace(/[^a-zA-Z_\-0-9\.]/g, '');

    if (bits.length === 0) {
      bits.push("1");
    }

    for (var i = 0; i < bits.length; i++) {
      var fields = bits[i].split("|");

      if (fields[1] === undefined) {
        self.log('Bad line: ' + fields + ' in msg "' + metrics[midx] +'"');
        continue;
      }

      var metric_type = fields[1].trim();

      /* Timer */
      if (metric_type === "ms") {
        self.enqueue('timer', ts, key, Number(fields[0] || 0));
      /* Gauge */
      } else if (metric_type === "g") {
        if (fields[0].match(/^[-+]/)) {
          self.logDebug('Sending gauges with +/- is not supported yet.');
        } else {
          self.enqueue('gauge', ts, key, Number(fields[0] || 0));
        }
      /* Set */
      } else if (metric_type === "s") {
        self.logDebug('Sets not supported yet.');
      /* Counter */
      } else {
        /* XXX Handle sampling. */
        self.enqueue('counter', ts, key, Number(fields[0] || 1));
      }
    }
  }
}

InfluxdbBackend.prototype.enqueue = function (type, ts, key, value) {
  var self = this;

  key = key + '.' + type + '.' + self.proxySuffix;

  if (!self.registry[key]) {
    self.registry[key] = [];
  }

  self.registry[key].push({value: value, time: ts});
}

InfluxdbBackend.prototype.flushQueue = function () {
  var self = this,
      registry = self.clearRegistry(),
      points = [];

  for (var key in registry) {
    var payload = self.assembleEvent(key, registry[key]);

    self.logDebug(function () {
      return 'Flush ' + registry[key].length + ' values for ' + key;
    });

    points.push(payload);
  }

  self.httpPOST(points);

  self.logDebug('Queue flushed');
}


InfluxdbBackend.prototype.clearRegistry = function () {
  var self = this,
      registry = self.registry;

  self.registry = {};

  return registry;
}

InfluxdbBackend.prototype.assembleEvent = function (name, events) {
  var self = this;

  var payload = {
    name: name,
    columns: Object.keys(events[0]),
    points: []
  };

  for (var idx in events) {
    var event = events[idx],
        points = [];

    for (var cidx in payload.columns) {
      var column = payload.columns[cidx];

      points.push(event[column]);
    }

    payload.points.push(points);
  }

  return payload;
}

InfluxdbBackend.prototype.httpPOST = function (points) {
  /* Do not send if there are no points. */
  if (!points.length) { return; }

  var self = this,
      query = {u: self.user, p: self.pass, time_precision: 'm'},
      protocolName = self.protocol == http ? 'HTTP' : 'HTTPS';

  self.logDebug(function () {
    return 'Sending ' + points.length + ' different points via ' + protocolName;
  });

  var options = {
    hostname: self.host,
    port: self.port,
    path: '/db/' + self.database + '/series?' + querystring.stringify(query),
    method: 'POST',
    agent: false // Is it okay to use "undefined" here? (keep-alive)
  };

  var req = self.protocol.request(options);

  req.on('response', function (res) {
    var status = res.statusCode;

    if (status !== 200) {
      self.log(protocolName + ' Error: ' + status);
    }
  });

  req.on('error', function (e, i) {
    self.log(e);
  });

  self.logDebug(function () {
    var str = JSON.stringify(points),
        size = (Buffer.byteLength(str) / 1024).toFixed(2);

    return 'Payload size ' + size + ' KB';
  });

  req.write(JSON.stringify(points));
  req.end();
}

InfluxdbBackend.prototype.configCheck = function () {
  var self = this,
      success = true;

  /* Make sure the database name and credentials are configured. */
  if (!self.user) {
    self.log('Missing config option: username');
    success = false;
  }
  if (!self.pass) {
    self.log('Missing config option: password');
    success = false;
  }
  if (!self.database) {
    self.log('Missing config option: database');
    success = false;
  }

  return success;
}

exports.init = function (startupTime, config, events) {
  var influxdb = new InfluxdbBackend(startupTime, config, events);

  return influxdb.configCheck();
}
