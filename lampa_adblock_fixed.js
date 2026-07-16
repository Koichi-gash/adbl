(function () {
  'use strict';

  if (window.__lampaSimpleAdblockInstalled) return;
  window.__lampaSimpleAdblockInstalled = true;

  var VERSION = '2026.07.16.2';

  var defaults = {
    lsa_enabled: true,
    lsa_vast: true,
    lsa_network: true,
    lsa_dom: true
  };

  var manifest = {
    type: 'plugin',
    version: VERSION,
    name: 'AdBlock',
    description: 'Блокировка рекламы для Lampa',
    component: 'simple_adblock'
  };

  var emptyJson = 'data:application/json;charset=utf-8,%7B%7D';

  var adHosts = [
    'doubleclick.net',
    'googlesyndication.com',
    'googleadservices.com',
    'adservice.google.com',
    'google-analytics.com',
    'googletagmanager.com',
    'googletagservices.com',
    'yandexadexchange.net',
    'an.yandex.ru',
    'mc.yandex.ru',
    'adsystem.com',
    'adnxs.com',
    'criteo.com',
    'criteo.net',
    'adriver.ru',
    'adfox.ru',
    'ad.mail.ru',
    'mytarget.ru',
    'bwa.ad',
    'vast.',
    'vpaid.'
  ];

  var accountHosts = [
    'cub.rip',
    'cub.red',
    'cab.rip'
  ];

  var adWord = '(ad|ads|advert|advertise|advertising|analytics|banner|clickunder|counter|metric|metrics|partner|popup|popunder|promo|preroll|midroll|postroll|roll|stat|stats|teaser|track|tracker|vast|vmap|vpaid)';
  var adUrlRe = new RegExp('(?:^|[/?#&_.=:-])' + adWord + '(?:$|[/?#&_.=:-])', 'i');
  var adHostRe = new RegExp('(^|[.-])' + adWord + '([.-]|$)', 'i');
  var accountUrlRe = /(?:^|[/?#&_.=:-])(account|auth|cabinet|check|device|login|me|payment|profile|session|signin|subscribe|subscription|tariff|token|user|users|verify)(?:$|[/?#&_.=:-])/i;

  function storage(name) {
    try {
      if (window.Lampa && Lampa.Storage) return Lampa.Storage.get(name, defaults[name]);
    } catch (e) {}
    return defaults[name];
  }

  function enabled(name) {
    var value = storage(name);
    return value === true || value === 'true';
  }

  function isHttp(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
  }

  function hostOf(value) {
    var match = /^https?:\/\/([^/:?#]+)/i.exec(value || '');
    return match ? match[1].toLowerCase() : '';
  }

  function hostMatches(host, domain) {
    return host === domain || host.slice(-(domain.length + 1)) === '.' + domain;
  }

  function isAccountHost(host) {
    return accountHosts.some(function (domain) {
      return hostMatches(host, domain);
    });
  }

  function hasAdHost(host) {
    if (!host) return false;
    if (adHostRe.test(host)) return true;

    return adHosts.some(function (domain) {
      return domain.slice(-1) === '.'
        ? host.indexOf(domain) === 0
        : hostMatches(host, domain);
    });
  }

  function isAccountUrl(value) {
    return isAccountHost(hostOf(value)) && accountUrlRe.test(value || '');
  }

  function isAdUrl(value) {
    if (!enabled('lsa_enabled') || !isHttp(value)) return false;

    var host = hostOf(value);
    if (!host) return false;

    if (hasAdHost(host)) return true;

    if (adUrlRe.test(value)) {
      if (isAccountUrl(value)) return false;
      return true;
    }

    return false;
  }

  function isAdKey(key) {
    return /^(ad|ads|advert|advertising|banner|banners|commercial|promo|teaser|vast|vmap|vpaid|preroll|midroll|postroll|roll)$/i.test(String(key || ''));
  }

  function objectHasAdMarker(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

    return Object.keys(value).some(function (key) {
      var item = value[key];
      return isAdKey(key) || (typeof item === 'string' && isAdUrl(item));
    });
  }

  function removeAdsFromObject(value, depth) {
    if (!enabled('lsa_enabled') || !enabled('lsa_vast') || depth > 10 || value == null) return value;

    if (typeof value === 'string') return value;

    if (Array.isArray(value)) {
      for (var i = value.length - 1; i >= 0; i--) {
        var item = value[i];
        if ((typeof item === 'string' && isAdUrl(item)) || objectHasAdMarker(item)) {
          value.splice(i, 1);
        } else {
          removeAdsFromObject(item, depth + 1);
        }
      }
      return value;
    }

    if (typeof value === 'object') {
      Object.keys(value).forEach(function (key) {
        var item = value[key];
        if (isAdKey(key) || (typeof item === 'string' && isAdUrl(item))) {
          delete value[key];
        } else {
          removeAdsFromObject(item, depth + 1);
        }
      });
    }

    return value;
  }

  function wrapCallback(callback) {
    if (typeof callback !== 'function' || callback.__simpleAdblockWrapped) return callback;

    var wrapped = function () {
      if (enabled('lsa_enabled') && enabled('lsa_vast')) {
        for (var i = 0; i < arguments.length; i++) removeAdsFromObject(arguments[i], 0);
      }
      return callback.apply(this, arguments);
    };

    wrapped.__simpleAdblockWrapped = true;
    return wrapped;
  }

  function patchPlayer() {
    if (!window.Lampa || !Lampa.Player || Lampa.Player.__simpleAdblockPatched) return;

    var originalPlay = Lampa.Player.play;
    var originalPlaylist = Lampa.Player.playlist;

    if (typeof originalPlay === 'function') {
      Lampa.Player.play = function (item) {
        removeAdsFromObject(item, 0);
        return originalPlay.call(this, item);
      };
    }

    if (typeof originalPlaylist === 'function') {
      Lampa.Player.playlist = function (items) {
        removeAdsFromObject(items, 0);
        return originalPlaylist.call(this, items);
      };
    }

    Lampa.Player.__simpleAdblockPatched = true;
  }

  function patchLampaRequest() {
    if (!window.Lampa || !Lampa.Reguest || Lampa.Reguest.__simpleAdblockPatched) return;

    ['silent', 'native'].forEach(function (name) {
      var original = Lampa.Reguest.prototype && Lampa.Reguest.prototype[name];
      if (typeof original !== 'function') return;

      Lampa.Reguest.prototype[name] = function () {
        var args = Array.prototype.slice.call(arguments);

        if (enabled('lsa_network') && isAdUrl(args[0])) args[0] = emptyJson;

        for (var i = 0; i < args.length; i++) {
          if (typeof args[i] === 'function') args[i] = wrapCallback(args[i]);
        }

        return original.apply(this, args);
      };
    });

    Lampa.Reguest.__simpleAdblockPatched = true;
  }

  function patchBrowserNetwork() {
    if (window.XMLHttpRequest && !XMLHttpRequest.prototype.__simpleAdblockPatched) {
      var originalOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        var args = Array.prototype.slice.call(arguments);
        if (enabled('lsa_network') && isAdUrl(url)) args[1] = emptyJson;
        return originalOpen.apply(this, args);
      };
      XMLHttpRequest.prototype.__simpleAdblockPatched = true;
    }

    if (window.fetch && !window.fetch.__simpleAdblockPatched) {
      var originalFetch = window.fetch;
      var patchedFetch = function (input, init) {
        var url = typeof input === 'string' ? input : input && input.url;

        if (enabled('lsa_network') && isAdUrl(url) && typeof Response === 'function') {
          return Promise.resolve(new Response('{}', {
            status: 200,
            headers: { 'Content-Type': 'application/json;charset=utf-8' }
          }));
        }

        return originalFetch.call(this, input, init);
      };

      patchedFetch.__simpleAdblockPatched = true;
      window.fetch = patchedFetch;
    }
  }

  function injectStyle() {
    if (!enabled('lsa_enabled') || !enabled('lsa_dom') || document.getElementById('simple-adblock-style')) return;

    var style = document.createElement('style');
    style.id = 'simple-adblock-style';
    style.textContent = [
      '[id*="advert" i],[id*="banner" i],[id*="preroll" i],[id*="teaser" i],[id*="vpaid" i],[id*="vmap" i],[id*="vast" i]',
      '[class*="advert" i],[class*="adver" i],[class*="banner" i],[class*="preroll" i],[class*="teaser" i],[class*="vpaid" i],[class*="vmap" i],[class*="vast" i]',
      '[data-ad],[data-ads],[data-advert],[data-banner]'
    ].join(',') + '{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;}';

    (document.head || document.documentElement).appendChild(style);
  }

  function hideNode(node) {
    if (!enabled('lsa_enabled') || !enabled('lsa_dom') || !node || node.nodeType !== 1) return;

    var src = node.getAttribute && (node.getAttribute('src') || node.getAttribute('href') || node.getAttribute('data-src'));
    var marker = [
      node.id || '',
      node.className || '',
      node.getAttribute && node.getAttribute('data-ad') || '',
      node.getAttribute && node.getAttribute('data-ads') || '',
      node.getAttribute && node.getAttribute('data-advert') || '',
      node.getAttribute && node.getAttribute('data-banner') || ''
    ].join(' ').toLowerCase();

    if (
      isAdUrl(src) ||
      /(^|\s|_|-)(ad|ads|advert|advertisement|banner|teaser|promo|vast|vmap|vpaid|preroll|midroll|postroll)(\s|$|_|-)/i.test(marker)
    ) {
      node.style.display = 'none';
      node.style.visibility = 'hidden';
      node.style.opacity = '0';
      node.style.pointerEvents = 'none';

      if (/^(SCRIPT|IFRAME)$/i.test(node.tagName) && node.parentNode) {
        node.parentNode.removeChild(node);
      }
    }
  }

  function patchDom() {
    if (!window.MutationObserver || window.__simpleAdblockDomPatched) return;
    window.__simpleAdblockDomPatched = true;

    function scan(root) {
      injectStyle();
      hideNode(root);
      if (!root || !root.querySelectorAll) return;

      var nodes = root.querySelectorAll('script[src],iframe[src],img[src],a[href],[src],[href],[data-src],[class],[id],[data-ad],[data-ads],[data-advert],[data-banner]');
      for (var i = 0; i < nodes.length; i++) hideNode(nodes[i]);
    }

    scan(document.documentElement);

    new MutationObserver(function (changes) {
      changes.forEach(function (change) {
        if (change.type === 'attributes') scan(change.target);
        for (var i = 0; i < change.addedNodes.length; i++) scan(change.addedNodes[i]);
      });
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'href', 'data-src', 'class', 'id', 'style', 'data-ad', 'data-ads', 'data-advert', 'data-banner']
    });
  }

  function addSettings() {
    if (!window.Lampa || !Lampa.SettingsApi || Lampa.SettingsApi.__simpleAdblockSettings) return;
    Lampa.SettingsApi.__simpleAdblockSettings = true;

    Lampa.SettingsApi.addComponent({
      component: 'simple_adblock',
      name: 'Блокировка рекламы',
      icon: '<svg height="36" viewBox="0 0 24 24" fill="none"><path d="M12 2l8 4v6c0 5-3.4 9-8 10-4.6-1-8-5-8-10V6l8-4z" stroke="currentColor" stroke-width="2"/><path d="M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    });

    function trigger(name, title, description, value) {
      Lampa.SettingsApi.addParam({
        component: 'simple_adblock',
        param: { name: name, type: 'trigger', default: value },
        field: { name: title, description: description }
      });
    }

    trigger('lsa_enabled', 'Включить', 'Главный переключатель блокировщика', true);
    trigger('lsa_vast', 'Убирать рекламу из плеера', 'Чистит VAST/VMAP/preroll/banner-поля в объектах видео и ответах парсеров', true);
    trigger('lsa_network', 'Блокировать рекламные запросы', 'Подменяет рекламные XHR/fetch/Lampa.Reguest на пустой JSON', true);
    trigger('lsa_dom', 'Скрывать баннеры', 'Скрывает рекламные блоки, iframe и скрипты в интерфейсе', true);
  }

  function setManifest() {
    try {
      if (window.Lampa && Lampa.Manifest) Lampa.Manifest.plugins = manifest;
    } catch (e) {}
  }

  function install() {
    if (!window.Lampa || !Lampa.Storage) {
      setTimeout(install, 250);
      return;
    }

    setManifest();
    addSettings();
    patchPlayer();
    patchLampaRequest();
    patchBrowserNetwork();
    patchDom();

    if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show('Блокировка рекламы включена ' + VERSION);
  }

  install();
})();
