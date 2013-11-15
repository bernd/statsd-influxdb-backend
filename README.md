StatsD InfluxDB backend
-----------------------

A naive [InfluxDB](http://influxdb.org/) backend for
[StatsD](https://github.com/etsy/statsd). It maps every incoming StatsD
packet to an InfluxDB event.

## CAVEATS

This is pretty young and I do not have much experience with InfluxDB yet.
Especially the event buffering and the event mapping might be problematic
and inefficient.

InfluxDB is also pretty young and there might be breaking changes until it
reaches 1.0.

Please be careful!

## Installation

    $ cd /path/to/statsd
    $ npm install statsd-influxdb-backend

## Configuration

You can configure the following settings in your StatsD config file.

```js
{
  influxdb: {
    flushInterval: 1000, // Flush interval for the internal buffer.
                         // (default 1000)
    host: '127.0.0.1',   // InfluxDB host. (default 127.0.0.1)
    port: 8086,          // InfluxDB port. (default 8086)
    database: 'dbname',  // InfluxDB database instance. (required)
    username: 'user',    // InfluxDB database username. (required)
    password: 'pass'     // InfluxDB database password. (required)
  }
}
```

## Activation

Add the `statsd-influxdb-backend` to the list of StatsD backends in the config
file and restart the StatsD process.

```js
{
  backends: ['./backends/graphite', 'statsd-influxdb-backend']
}
```

## Unsupported Metric Types

* Counter with sampling.
* Signed gauges. (i.e. `bytes:+4|g`)
* Sets

## InfluxDB Event Mapping

StatsD packets are currently mapped to the following InfluxDB events. This is
a first try and I'm open to suggestions to improve this.

### Counter

StatsD packet `requests:1|c` as InfluxDB event:

```js
[
  {
    name: 'requests',
    columns: ['type', 'value', 'time'],
    points: [
      ['counter', 1, 1384472029572]
    ]
  }
]
```

### Timing

StatsD packet `response_time:170|ms` as InfluxDB event:

```js
[
  {
    name: 'response_time',
    columns: ['type', 'value', 'time'],
    points: [
      ['timing', 170, 1384472029572]
    ]
  }
]
```

### Gauges

StatsD packet `bytes:123|g` as InfluxDB event:

```js
[
  {
    name: 'bytes',
    columns: ['type', 'value', 'time'],
    points: [
      ['gauge', 123, 1384472029572]
    ]
  }
]
```

## Event Buffering

To avoid one HTTP request per StatsD packet, the InfluxDB backend buffers the
incoming events and flushes the buffer on a regular basis. The current default
is 1000ms. Use the `influxdb.flushInterval` to change the interval.

This might become a problem with lots of incoming events.

The payload of a HTTP request might look like this:

```js
[
  {
    name: 'requests',
    columns: ['type', 'value', 'time'],
    points: [
      ['counter', 1, 1384472029572],
      ['counter', 1, 1384472029573],
      ['counter', 1, 1384472029580]
    ]
  },
  {
    name: 'response_time',
    columns: ['type', 'value', 'time'],
    points: [
      ['timing', 170, 1384472029570],
      ['timing', 189, 1384472029572],
      ['timing', 234, 1384472029578],
      ['timing', 135, 1384472029585]
    ]
  },
  {
    name: 'bytes',
    columns: ['type', 'value', 'time'],
    points: [
      ['gauge', 123, 1384472029572],
      ['gauge', 123, 1384472029580]
    ]
  }
]
```

## Contributing

All contributions are welcome: ideas, patches, documentation, bug reports,
complaints, and even something you drew up on a napkin.
