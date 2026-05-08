// =====================================================
// HANDS Platform - 노동자 PWA 위치 기록 강화
// =====================================================
// 이 파일을 참고하여 기존 index.html의 위치 추적 부분을 교체/추가하세요.
// 핵심: 앱을 켤 때마다, 그리고 켜져있는 동안 5초마다 위치 기록 → location_history 누적
// =====================================================

const SUPA_URL = 'https://wcugfateeuqfcpimoogo.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'; // 기존 ANON 키 그대로
const sb = supabase.createClient(SUPA_URL, SUPA_KEY);

let memberId = localStorage.getItem('hands_member_id'); // 가입 후 저장된 ID
let watchId = null;
let lastSavedAt = 0;
let lastSavedPos = null;

// =====================================================
// 1. 앱 켤 때 - 위치 1회 기록 (트리거: 'app_open')
// =====================================================
async function recordOpenLocation(){
  if(!memberId) return;
  if(!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = Math.round(pos.coords.accuracy);
      const now = new Date().toISOString();

      // 현재 위치 upsert
      await sb.from('locations').upsert({
        member_id: memberId,
        lat, lng, accuracy: acc,
        updated_at: now
      });

      // 이력 저장
      await sb.from('location_history').insert({
        member_id: memberId,
        lat, lng, accuracy: acc,
        source: 'app_open',
        recorded_at: now
      });

      // 마지막 접속 시각 업데이트
      await sb.from('members').update({last_seen_at: now}).eq('id', memberId);

      lastSavedAt = Date.now();
      lastSavedPos = {lat, lng};
      console.log('[HANDS] app_open 위치 기록:', lat, lng);
    },
    (err) => console.warn('[HANDS] 위치 권한 거부 또는 실패:', err),
    {enableHighAccuracy: true, timeout: 10000, maximumAge: 60000}
  );
}

// =====================================================
// 2. 앱 켜져있는 동안 - 5초마다 위치 갱신 (트리거: 'watch')
// =====================================================
function startWatchLocation(){
  if(!memberId) return;
  if(!navigator.geolocation) return;
  if(watchId !== null) return; // 이미 시작됨

  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = Math.round(pos.coords.accuracy);
      const now = Date.now();

      // 5초 미만 텀이면 스킵
      if(now - lastSavedAt < 5000) return;

      // 1m 미만 이동이면 스킵 (정지 상태)
      if(lastSavedPos){
        const dist = haversine(lastSavedPos.lat, lastSavedPos.lng, lat, lng);
        if(dist < 1) return;
      }

      const isoNow = new Date(now).toISOString();
      // 현재 위치 upsert (실시간 마커 갱신)
      await sb.from('locations').upsert({
        member_id: memberId,
        lat, lng, accuracy: acc,
        updated_at: isoNow
      });

      // 30초마다 한 번씩만 history에 저장 (DB 절약)
      if(!lastSavedPos || now - lastSavedAt > 30000){
        await sb.from('location_history').insert({
          member_id: memberId,
          lat, lng, accuracy: acc,
          source: 'watch',
          recorded_at: isoNow
        });
      }

      lastSavedAt = now;
      lastSavedPos = {lat, lng};
    },
    (err) => console.warn('[HANDS] watchPosition 오류:', err),
    {enableHighAccuracy: true, timeout: 30000, maximumAge: 5000}
  );
}

function stopWatchLocation(){
  if(watchId !== null){
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

// =====================================================
// 3. SOS 발생 시 - 위치 즉시 기록 (트리거: 'sos')
// =====================================================
async function triggerSOS(message){
  if(!memberId){ alert('로그인이 필요합니다'); return; }

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const now = new Date().toISOString();

    // SOS 알림 발송
    await sb.from('sos_alerts').insert({
      member_id: memberId,
      lat, lng,
      message: message || '도움 요청',
      status: 'pending',
      created_at: now
    });

    // 이력에도 SOS 위치 저장
    await sb.from('location_history').insert({
      member_id: memberId,
      lat, lng,
      source: 'sos',
      recorded_at: now
    });

    // 현재 위치 갱신
    await sb.from('locations').upsert({
      member_id: memberId,
      lat, lng,
      updated_at: now
    });

    alert('SOS 신호가 관리자에게 전송되었습니다');
  }, (err) => {
    // GPS 안 잡혀도 SOS 자체는 보냄
    sb.from('sos_alerts').insert({
      member_id: memberId,
      lat: null, lng: null,
      message: message || '도움 요청 (위치 미상)',
      status: 'pending'
    }).then(() => alert('SOS 전송됨 (위치 미확인)'));
  });
}

// =====================================================
// 4. 백그라운드 진입 직전 - 마지막 위치 1회 더 저장
// =====================================================
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'hidden'){
    // 백그라운드로 가기 직전 마지막 위치 한 번 더 기록
    if(memberId && lastSavedPos){
      // navigator.sendBeacon으로 연결 끊겨도 전송됨
      const data = new Blob([JSON.stringify({
        member_id: memberId,
        lat: lastSavedPos.lat,
        lng: lastSavedPos.lng,
        source: 'background',
        recorded_at: new Date().toISOString()
      })], {type:'application/json'});
      // 참고: Supabase REST 직접 호출 시 sendBeacon 가능
      // 여기선 일반 fetch (실패할 수도 있지만 시도는 함)
      sb.from('location_history').insert({
        member_id: memberId,
        lat: lastSavedPos.lat,
        lng: lastSavedPos.lng,
        source: 'background',
        recorded_at: new Date().toISOString()
      }).then(()=>{}).catch(()=>{});
    }
    stopWatchLocation();
  } else if(document.visibilityState === 'visible'){
    // 다시 앱이 보이면 위치 기록 재개
    recordOpenLocation();
    startWatchLocation();
  }
});

// =====================================================
// 5. 거리 계산 (m 단위)
// =====================================================
function haversine(lat1, lng1, lat2, lng2){
  const R = 6371000;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLng = (lng2-lng1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *
    Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// =====================================================
// 6. 페이지 로드 시 자동 시작
// =====================================================
window.addEventListener('DOMContentLoaded', () => {
  if(memberId){
    recordOpenLocation();   // 앱 켤 때 1회
    startWatchLocation();    // 그 후 watch 시작
  }
});

// SOS 버튼 연결 예시:
// document.getElementById('sos-btn').onclick = () => triggerSOS('도움 요청');
