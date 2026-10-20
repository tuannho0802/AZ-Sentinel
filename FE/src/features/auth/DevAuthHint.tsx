/** Chỉ hiện khi chạy `pnpm dev`; bị loại khỏi bản build (import.meta.env.DEV = false). */
export function DevAuthHint() {
  return (
    <div className="mt-6 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">Chế độ giả lập đăng nhập (chỉ dev, chưa phải đăng nhập thật)</p>
      <ul className="mt-1 list-disc pl-5">
        <li>admin@az.local / admin1234 (rootAdmin)</li>
        <li>user@az.local / user1234 (User)</li>
        <li>pending@az.local / pending1234 (chờ duyệt, bị từ chối)</li>
        <li>Sai 5 lần liên tiếp: bị chặn 30 giây (429)</li>
      </ul>
    </div>
  )
}
