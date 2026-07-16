(function () {
  'use strict';

  if (window.__lampaAdBlockInstalled) return;
  window.__lampaAdBlockInstalled = true;

  var VERSION = '1.0.1';
  var EMPTY_JSON_URL = 'data:application/json;charset=utf-8,%7B%7D';
  var defaults = {
    lampa_adblock_enabled: true,
    lampa_adblock_network: true,
    lampa_adblock_player: true,
    lampa_adblock_dom: true
  };

  var manifest = {
    type: 'plugin',
    version: VERSION,
    name: 'Lampa AdBlock',
    description: 'Блокировка рекламных запросов, VAST/VMAP и баннеров',
    component: 'lampa_adblock'
  };

  var blockedHosts = [
    'doubleclick.net',
    'googlesyndication.com',
    'googleadservices.com',
    'googletagmanager.com',
    'googletagservices.com',
    'google-analytics.com',
    'imasdk.googleapis.com',
    'yandexadexchange.net',
    'an.yandex.ru',
    'mc.yandex.ru',
    'adfox.ru',
    'adriver.ru',
    'adnxs.com',
    'criteo.com',
    'criteo.net',
    'mytarget.ru',
    'ad.mail.ru'
  ];

  var protectedHosts = ['cub.rip', 'cub.red', 'cab.rip'];
  var hostMarker = /(^|[.-])(ads?|advert|analytics|metrics|tracker|tracking|counter)([.-]|$)/i;
  var pathMarker = /(?:^|[\/?#&_.=:-])(vast|vmap|vpaid|preroll|midroll|postroll|advertising|adtag|adserver|banner)(?:$|[\/?#&_.=:-])/i;
  var accountMarker = /(?:^|[\/?#&_.=:-])(account|auth|cabinet|device|login|payment|profile|session|signin|subscription|tariff|token|user|verify)(?:$|[\/?#&_.=:-])/i;
  var adKeyMarker = /^(ad|ads|advert|advertising|banner|banners|commercial|vast|vmap|vpaid|preroll|midroll|postroll)$/i;
  var domMarker = /(^|[\s_-])(ad|ads|advert|advertisement|banner|teaser|vast|vmap|vpaid|preroll|midroll|postroll)([\s_-]|$)/i;

  function getSetting(name) {
    try {
      if (window.Lampa && Lampa.Storage) return Lampa.Storage.get(name, defaults[name]);
    } catch (e) {}
    return defaults[name];
  }

  function enabled(name) {
    var value = getSetting(name);
    return value === true || value === 'true';
  }

  function hostOf(url) {
    var match = /^https?:\/\/([^\/:?#]+)/i.exec(typeof url === 'string' ? url : '');
    return match ? match[1].toLowerCase() : '';
  }

  function hostMatches(host, domain) {
    return host === domain || host.slice(-(domain.length + 1)) === '.' + domain;
  }

  function inHostList(host, list) {
    for (var i = 0; i < list.length; i++) {
      if (hostMatches(host, list[i])) return true;
    }
    return false;
  }

  function isAdUrl(url) {
    if (!enabled('lampa_adblock_enabled') || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;

    var host = hostOf(url);
    if (!host) return false;
    if (inHostList(host, blockedHosts) || hostMarker.test(host)) return true;

    // Не блокируем авторизацию и оплату CUB даже при наличии спорного слова в query.
    if (inHostList(host, protectedHosts) && accountMarker.test(url)) return false;
    return pathMarker.test(url);
  }

  function isAdKey(key) {
    return adKeyMarker.test(String(key || ''));
  }

  function cleanAds(value, depth) {
    if (!enabled('lampa_adblock_enabled') || !enabled('lampa_adblock_player') || value == null || depth > 10) return value;

    if (Array.isArray(value)) {
      for (var i = value.length - 1; i >= 0; i--) {
        if (typeof value[i] === 'string' && isAdUrl(value[i])) value.splice(i, 1);
        else cleanAds(value[i], depth + 1);
      }
    } else if (typeof value === 'object') {
      try {
        Object.keys(value).forEach(function (key) {
          if (isAdKey(key) || (typeof value[key] === 'string' && isAdUrl(value[key]))) delete value[key];
          else cleanAds(value[key], depth + 1);
        });
      } catch (e) {}
    }

    return value;
  }

  function wrapCallback(callback) {
    if (typeof callback !== 'function' || callback.__lampaAdBlockWrapped) return callback;
    var wrapped = function () {
      for (var i = 0; i < arguments.length; i++) cleanAds(arguments[i], 0);
      return callback.apply(this, arguments);
    };
    wrapped.__lampaAdBlockWrapped = true;
    return wrapped;
  }

  function patchRequestInstance(instance) {
    if (!instance || instance.__lampaAdBlockPatched) return instance;
    instance.__lampaAdBlockPatched = true;

    ['get', 'quiet', 'silent', 'last', 'native'].forEach(function (name) {
      var original = instance[name];
      if (typeof original !== 'function') return;
      instance[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        if (enabled('lampa_adblock_network') && isAdUrl(args[0])) args[0] = EMPTY_JSON_URL;
        for (var i = 0; i < args.length; i++) {
          if (typeof args[i] === 'function') args[i] = wrapCallback(args[i]);
        }
        return original.apply(instance, args);
      };
    });

    return instance;
  }

  function patchLampaRequest() {
    if (!window.Lampa || typeof Lampa.Reguest !== 'function' || Lampa.Reguest.__lampaAdBlockPatched) return;

    var OriginalRequest = Lampa.Reguest;
    var PatchedRequest = function () {
      var args = [null].concat(Array.prototype.slice.call(arguments));
      var Bound = Function.prototype.bind.apply(OriginalRequest, args);
      return patchRequestInstance(new Bound());
    };

    PatchedRequest.prototype = OriginalRequest.prototype;
    PatchedRequest.__lampaAdBlockPatched = true;
    Lampa.Reguest = PatchedRequest;
  }

  function patchPlayer() {
    if (!window.Lampa || !Lampa.Player || Lampa.Player.__lampaAdBlockPatched) return;
    ['play', 'playlist'].forEach(function (name) {
      var original = Lampa.Player[name];
      if (typeof original !== 'function') return;
      Lampa.Player[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        for (var i = 0; i < args.length; i++) cleanAds(args[i], 0);
        return original.apply(this, args);
      };
    });
    Lampa.Player.__lampaAdBlockPatched = true;
  }

  function patchBrowserNetwork() {
    if (window.XMLHttpRequest && !XMLHttpRequest.prototype.__lampaAdBlockPatched) {
      var originalOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function () {
        var args = Array.prototype.slice.call(arguments);
        if (enabled('lampa_adblock_network') && isAdUrl(args[1])) args[1] = EMPTY_JSON_URL;
        return originalOpen.apply(this, args);
      };
      XMLHttpRequest.prototype.__lampaAdBlockPatched = true;
    }

    if (typeof window.fetch === 'function' && !window.fetch.__lampaAdBlockPatched) {
      var originalFetch = window.fetch;
      var patchedFetch = function (input, init) {
        var url = typeof input === 'string' ? input : input && input.url;
        if (enabled('lampa_adblock_network') && isAdUrl(url) && typeof window.Response === 'function') {
          return Promise.resolve(new Response('{}', {
            status: 200,
            headers: { 'Content-Type': 'application/json;charset=utf-8' }
          }));
        }
        return originalFetch.call(this, input, init);
      };
      patchedFetch.__lampaAdBlockPatched = true;
      window.fetch = patchedFetch;
    }
  }

  function setRootClass(active) {
    var root = document.documentElement;
    if (!root) return;
    if (root.classList) root.classList[active ? 'add' : 'remove']('lampa-adblock-active');
    else if (active && root.className.indexOf('lampa-adblock-active') < 0) root.className += ' lampa-adblock-active';
    else if (!active) root.className = root.className.replace(/\blampa-adblock-active\b/g, '');
  }

  function injectStyle() {
    if (document.getElementById('lampa-adblock-style')) return;
    var style = document.createElement('style');
    style.id = 'lampa-adblock-style';
    style.textContent = 'html.lampa-adblock-active .lampa-adblock-hidden{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}';
    (document.head || document.documentElement).appendChild(style);
  }

  function markNode(node) {
    if (!node || node.nodeType !== 1) return;
    var read = function (name) { return node.getAttribute ? node.getAttribute(name) || '' : ''; };
    var url = read('src') || read('href') || read('data-src');
    var marker = [node.id || '', typeof node.className === 'string' ? node.className : '', read('data-ad'), read('data-ads'), read('data-advert'), read('data-banner')].join(' ');
    var shouldHide = isAdUrl(url) || domMarker.test(marker);

    if (node.classList) {
      var isHidden = node.classList.contains('lampa-adblock-hidden');
      if (shouldHide && !isHidden) node.classList.add('lampa-adblock-hidden');
      if (!shouldHide && isHidden) node.classList.remove('lampa-adblock-hidden');
    }
  }

  function scanDom(root) {
    var active = enabled('lampa_adblock_enabled') && enabled('lampa_adblock_dom');
    setRootClass(active);
    if (!active || !root) return;
    markNode(root);
    if (!root.querySelectorAll) return;

    var nodes = root.querySelectorAll('script[src],iframe[src],img[src],a[href],[data-src],[data-ad],[data-ads],[data-advert],[data-banner],[class],[id]');
    for (var i = 0; i < nodes.length; i++) markNode(nodes[i]);
  }

  function patchDom() {
    injectStyle();
    scanDom(document.documentElement);
    if (!window.MutationObserver || window.__lampaAdBlockDomPatched) return;
    window.__lampaAdBlockDomPatched = true;

    new MutationObserver(function (changes) {
      for (var i = 0; i < changes.length; i++) {
        if (changes[i].type === 'attributes') markNode(changes[i].target);
        for (var j = 0; j < changes[i].addedNodes.length; j++) scanDom(changes[i].addedNodes[j]);
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'href', 'data-src', 'data-ad', 'data-ads', 'data-advert', 'data-banner']
    });
  }

  function addSettings() {
    if (!window.Lampa || !Lampa.SettingsApi || Lampa.SettingsApi.__lampaAdBlockAdded) return;
    Lampa.SettingsApi.__lampaAdBlockAdded = true;
    Lampa.SettingsApi.addComponent({
      component: 'lampa_adblock',
      name: 'Блокировка рекламы',
      icon: '<svg height="36" viewBox="0 0 24 24" fill="none"><path d="M12 2l8 4v6c0 5-3.4 9-8 10-4.6-1-8-5-8-10V6l8-4z" stroke="currentColor" stroke-width="2"/><path d="M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    });

    function trigger(name, title, description) {
      Lampa.SettingsApi.addParam({
        component: 'lampa_adblock',
        param: { name: name, type: 'trigger', 'default': true },
        field: { name: title, description: description }
      });
    }

    trigger('lampa_adblock_enabled', 'Включить', 'Главный переключатель блокировщика');
    trigger('lampa_adblock_network', 'Блокировать запросы', 'Блокирует рекламные XHR, fetch и запросы расширений');
    trigger('lampa_adblock_player', 'Чистить данные плеера', 'Удаляет VAST, VMAP, VPAID и рекламные вставки из плейлистов');
    trigger('lampa_adblock_dom', 'Скрывать баннеры', 'Скрывает рекламные элементы в интерфейсе');
  }

  function install() {
    if (window.__lampaAdBlockStarted || !window.Lampa || !Lampa.Storage) return;
    window.__lampaAdBlockStarted = true;
    try { Lampa.Manifest.plugins = manifest; } catch (e) {}
    addSettings();
    patchPlayer();
    patchBrowserNetwork();
    patchDom();

    if (Lampa.Storage.listener && Lampa.Storage.listener.follow) {
      Lampa.Storage.listener.follow('change', function (event) {
        if (event && String(event.name).indexOf('lampa_adblock_') === 0) scanDom(document.documentElement);
      });
    }
  }

  function bootstrap() {
    if (!window.Lampa) {
      setTimeout(bootstrap, 250);
      return;
    }

    // Не вмешиваемся в сеть и DOM, пока сама Lampa полностью не запустилась.
    if (window.appready) {
      install();
    } else if (Lampa.Listener && Lampa.Listener.follow) {
      Lampa.Listener.follow('app', function (event) {
        if (event && event.type === 'ready') install();
      });
    } else {
      setTimeout(bootstrap, 500);
    }
  }

  window.LampaAdBlock = {
    version: VERSION,
    isAdUrl: isAdUrl,
    clean: function (value) { return cleanAds(value, 0); },
    scan: function () { scanDom(document.documentElement); }
  };

  bootstrap();
})();
