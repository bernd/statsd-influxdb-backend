StatsD InfluxDB backend - CHANGELOG
-----------------------------------
## v0.5.1 (2015-06-18)

* Works with InfluxDb 0.9 line protocol `<measurement>[,<tag-key>=<tag-value>...] <field-key>=<field-value>[,<field2-key>=<field2-value>...] [unix-nano-timestamp]`

## v0.5.0 (2015-04-02)

* Unbreak conditional. (#13)
* Updated regex for statsd metrics. (#12)
* Expose internal backend metrics. (#9)

## v0.4.1 (2015-02-23)

* Use prefixStats setting instead of hardcoding prefix. (#6)

## v0.4.0 (2015-02-22)

* Add configuration option to enable sending internal statsd metrics. (#6)
* Add SET support. (#7)
* Fix problem with histograms breaking data flushes. (#8)
* Add SSL support. (#3)
* Improve configuration example in README.

## v0.3.0 (2014-08-24)

* Allow gauges with a value of 0 to be sent. (#2)
* Update `time_precision` to use `ms`. (#1)

## v0.2.0 (2013-11-19)

* Add flush strategy and enable it by default.
* Add configuration options for flush and proxy strategy.

## v0.1.0 (2013-11-15)

* Initial release.
