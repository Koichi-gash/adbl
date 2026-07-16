(function () {
  'use strict';

  if (window.__lampaSimpleAdblockInstalled) return;
  window.__lampaSimpleAdblockInstalled = true;

  var defaults = {
    lsa_enabled: true,
    lsa_vast: true,
    lsa_network: true,
    lsa_dom: true
  };

  var emptyJson = 'data:application/json;charset=utf-8,%7B%7D';
  var emptyText = 'data:text/plain;charset=utf-8,';

  var adHosts = [
    'doubleclick.net',
    'googlesyndication.com',
    'googleadservices.com',
    'adservice.google.com',
    'google-analytics.com',
    'googletagmanager.com',
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
    'vast.',
    'vpaid.'
  ];

  var safeHosts = [
    'cub.rip',
    'cub.red',
    'cab.rip'
  ];

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

  function isSafeUrl(value) {
    var host = hostOf(value);
    return safeHosts.some(function (domain) {
      return hostMatches(host, domain);
    });
  }

  function isAdUrl(value) {
    if (!enabled('lsa_enabled') || !isHttp(value) || isSafeUrl(value)) return false;

    var host = hostOf(value);
    if (!host) return false;

    if (/(^|[.-])(ads?|advert|analytics|metrics|tracker|stat|counter|banner|teaser)([.-]|$)/i.test(host)) {
      return true;
    }

    if (adHosts.some(function (domain) {
      return domain.slice(-1) === '.'
        ? host.indexOf(domain) === 0
        : hostMatches(host, domain);
    })) {
      return true;
    }

    return /(?:\/|[?&#_=.-])(vast|vmap|vpaid|preroll|midroll|postroll|advert|ads?|banner|teaser|promo)(?:\/|[?&#_=.-]|$)/i.test(value);
  }

  function removeAdsFromObject(value, depth) {
    if (!enabled('lsa_enabled') || !enabled('lsa_vast') || depth > 8 || value == null) return value;

    if (Array.isArray(value)) {
      for (var i = value.length - 1; i >= 0; i--) {
        if (isAdUrl(value[i])) value.splice(i, 1);
        else removeAdsFromObject(value[i], depth + 1);
      }
      return value;
    }

    if (typeof value === 'object') {
      Object.keys(value).forEach(function (key) {
        var low = String(key).toLowerCase();
        var item = value[key];

        if (
          /^(vast|vmap|vpaid|preroll|midroll|postroll|advert|ads?|banner|teaser|promo)/i.test(low) ||
          (typeof item === 'string' && isAdUrl(item))
        ) {
          delete value[key];
        } else {
          removeAdsFromObject(item, depth + 1);
        }
      });
    }

    return value;
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
        if (enabled('lsa_network') && isAdUrl(args[0])) {
          args[0] = emptyJson;
        }
        return original.apply(this, args);
      };
    });

    Lampa.Reguest.__simpleAdblockPatched = true;
  }

  function patchBrowserNetwork() {
    if (!enabled('lsa_network')) return;

    if (window.XMLHttpRequest && !XMLHttpRequest.prototype.__simpleAdblockPatched) {
      var originalOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        var args = Array.prototype.slice.call(arguments);
        if (isAdUrl(url)) args[1] = emptyJson;
        return originalOpen.apply(this, args);
      };
      XMLHttpRequest.prototype.__simpleAdblockPatched = true;
    }

    if (window.fetch && !window.fetch.__simpleAdblockPatched) {
      var originalFetch = window.fetch;
      var patchedFetch = function (input, init) {
        var url = typeof input === 'string' ? input : input && input.url;
        if (isAdUrl(url)) {
          return Promise.resolve(new Response('{}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        return originalFetch.call(this, input, init);
      };
      patchedFetch.__simpleAdblockPatched = true;
      window.fetch = patchedFetch;
    }
  }

  function hideNode(node) {
    if (!enabled('lsa_enabled') || !enabled('lsa_dom') || !node || node.nodeType !== 1) return;

    var src = node.getAttribute && (node.getAttribute('src') || node.getAttribute('href'));
    var marker = [
      node.id || '',
      node.className || '',
      node.getAttribute && node.getAttribute('data-ad') || '',
      node.getAttribute && node.getAttribute('data-banner') || ''
    ].join(' ').toLowerCase();

    if (
      isAdUrl(src) ||
      /(^|\s)(ad|ads|advert|advertisement|ad-server|banner|teaser|promo|vast|vmap|vpaid|preroll|midroll|postroll)(\s|$|__|-)/i.test(marker)
    ) {
      node.style.display = 'none';
      node.style.visibility = 'hidden';
      if (/^(SCRIPT|IFRAME)$/i.test(node.tagName) && node.parentNode) {
        node.parentNode.removeChild(node);
      }
    }
  }

  function patchDom() {
    if (!window.MutationObserver || window.__simpleAdblockDomPatched) return;
    window.__simpleAdblockDomPatched = true;

    function scan(root) {
      hideNode(root);
      if (!root || !root.querySelectorAll) return;
      var nodes = root.querySelectorAll('script[src],iframe[src],img[src],a[href],[class],[id],[data-ad],[data-banner]');
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
      attributeFilter: ['src', 'href', 'class', 'id', 'style', 'data-ad', 'data-banner']
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
    trigger('lsa_vast', 'Убирать VAST/VMAP', 'Удаляет рекламные поля из объекта плеера', true);
    trigger('lsa_network', 'Блокировать запросы', 'Подменяет рекламные XHR/fetch/Lampa.Reguest на пустой ответ', true);
    trigger('lsa_dom', 'Скрывать баннеры', 'Удаляет iframe/script и скрывает рекламные блоки в интерфейсе', true);
  }

  function install() {
    if (!window.Lampa || !Lampa.Storage) {
      setTimeout(install, 250);
      return;
    }

    addSettings();
    patchPlayer();
    patchLampaRequest();
    patchBrowserNetwork();
    patchDom();

    if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show('Блокировка рекламы включена');
  }

  install();
})();
