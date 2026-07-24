/**
 * Map — photo locations on a Leaflet map inside a WebView (Expo Go-safe).
 * Mirrors the web MapView: CARTO dark tiles, pixel-grid clustering with a
 * cover-photo pin + count badge; tapping a single photo opens the viewer,
 * tapping a cluster zooms in. Marker thumbnails auth via ?token= (the gateway
 * accepts it since <img> can't send headers).
 */
import { useMemo } from 'react';
import { View, Pressable } from 'react-native';
import { WebView } from 'react-native-webview';
import { router, Stack } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useLibrary, useNookClient, type PhotoRecord } from '@nook/core';
import { Text, BrandLoader, ScreenHeader } from '@/components/ui';
import { useViewer } from '@/store/viewer';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

function hasGps(p: PhotoRecord): boolean {
  return (
    p.latitude != null && p.longitude != null &&
    !(Math.abs(p.latitude) < 0.01 && Math.abs(p.longitude) < 0.01) &&
    Math.abs(p.latitude) <= 85
  );
}

export default function MapScreen() {
  const t = useTheme();
  const client = useNookClient();
  const token = useAuth((s) => s.token);
  const library = useLibrary();
  const setViewerList = useViewer((s) => s.setList);
  // On Android a WebView draws on top of screens pushed above it, so unmount it
  // whenever the Map isn't the focused screen (e.g. after opening a photo).
  const focused = useIsFocused();

  const geo = useMemo(
    () => (library.data ?? []).filter((p) => !p.hidden && hasGps(p)),
    [library.data],
  );

  const html = useMemo(() => {
    const points = geo.map((p) => ({ id: p.id, lat: p.latitude!, lon: p.longitude! }));
    return buildHtml(client.baseUrl, token ?? '', points);
  }, [geo, client.baseUrl, token]);

  function onMessage(id: string) {
    const photo = geo.find((p) => p.id === id);
    if (!photo) return;
    setViewerList(geo);
    router.push({ pathname: '/photo/[id]', params: { id } });
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        title="Map"
        right={geo.length ? <Text variant="caption" color={t.colors.onSurfaceVariant}>{geo.length.toLocaleString()} items</Text> : undefined}
      />

      {library.isLoading ? (
        <BrandLoader label="Loading map…" />
      ) : geo.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.spacing.xl, gap: t.spacing.md }}>
          <MaterialIcons name="map" size={44} color={t.colors.outline} />
          <Text variant="body" color={t.colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
            No photos with location data yet.
          </Text>
        </View>
      ) : focused ? (
        <WebView
          originWhitelist={['*']}
          source={{ html }}
          style={{ flex: 1, backgroundColor: t.colors.background }}
          javaScriptEnabled
          domStorageEnabled
          onMessage={(e) => {
            try {
              const msg = JSON.parse(e.nativeEvent.data);
              if (msg?.type === 'open' && msg.id) onMessage(String(msg.id));
            } catch {
              /* ignore */
            }
          }}
        />
      ) : (
        <View style={{ flex: 1, backgroundColor: t.colors.background }} />
      )}
    </SafeAreaView>
  );
}

function buildHtml(base: string, token: string, points: { id: string; lat: number; lon: number }[]): string {
  const data = JSON.stringify(points).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  html,body,#map{height:100%;margin:0;background:#0b0b0c}
  .pin{width:44px;height:44px;border-radius:10px;overflow:hidden;border:2px solid #57d38a;box-shadow:0 2px 8px rgba(0,0,0,.5);position:relative;background:#161618}
  .pin img{width:100%;height:100%;object-fit:cover;display:block}
  .badge{position:absolute;top:-6px;right:-6px;background:#57d38a;color:#06140c;font:700 11px system-ui;border-radius:9px;padding:1px 5px;min-width:14px;text-align:center}
  .leaflet-control-attribution{font-size:9px}
</style></head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var BASE=${JSON.stringify(base)}, TOKEN=${JSON.stringify(token)}, POINTS=${data};
  function thumb(id){return BASE+'/api/photos/'+id+'/thumb?w=128&token='+encodeURIComponent(TOKEN);}
  function RN(o){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  var map=L.map('map',{zoomControl:true,attributionControl:true}).setView([20,0],2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:19,subdomains:'abcd',attribution:'&copy; OpenStreetMap &copy; CARTO'}).addTo(map);
  var layer=L.layerGroup().addTo(map);
  function render(){
    layer.clearLayers();
    var cells={};
    for(var i=0;i<POINTS.length;i++){
      var pt=POINTS[i];
      var pxl=map.latLngToContainerPoint([pt.lat,pt.lon]);
      var key=Math.round(pxl.x/56)+':'+Math.round(pxl.y/56);
      (cells[key]=cells[key]||[]).push(pt);
    }
    Object.keys(cells).forEach(function(k){
      var g=cells[k], c=g[0];
      var html='<div class="pin"><img src="'+thumb(c.id)+'"/>'+(g.length>1?'<span class="badge">'+(g.length>99?'99+':g.length)+'</span>':'')+'</div>';
      var icon=L.divIcon({html:html,className:'',iconSize:[48,48],iconAnchor:[24,24]});
      var m=L.marker([c.lat,c.lon],{icon:icon}).addTo(layer);
      m.on('click',function(){
        if(g.length===1){ RN({type:'open',id:c.id}); }
        else { map.setView([c.lat,c.lon], Math.min(map.getZoom()+2,18)); }
      });
    });
  }
  map.on('moveend zoomend', render);
  try{ if(POINTS.length){ map.fitBounds(POINTS.map(function(p){return [p.lat,p.lon];}),{padding:[40,40],maxZoom:12}); } }catch(e){}
  render();
</script></body></html>`;
}
