/*
 * Service worker của AZ Sentinel (PWA). Cố ý TỐI GIẢN:
 * - Không cache giao diện hay dữ liệu: bản giao diện thật luôn lấy từ mạng (Worker chuyển hướng sang tunnel còn
 *   sống), nên không có chuyện chạy bản cũ, và không đụng tới `/api/*`, WebSocket hay đăng nhập.
 * - Chỉ có một việc: khi mở trang mà mất mạng thì hiện `/offline.html` thay vì trang lỗi của trình duyệt.
 * Đổi nội dung `offline.html` thì tăng CACHE để bản cũ bị xóa.
 */
const CACHE = 'az-offline-v1'
const OFFLINE = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(OFFLINE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  // Chỉ lượt mở trang. Không chạm vào request khác (API, ảnh, script...) để chúng đi thẳng ra mạng.
  if (req.mode !== 'navigate') return
  // Phản hồi chuyển hướng (302 sang tunnel) của Worker vẫn đi qua bình thường: lỗi mạng mới rơi về trang offline.
  event.respondWith(fetch(req).catch(async () => (await caches.match(OFFLINE)) ?? Response.error()))
})
