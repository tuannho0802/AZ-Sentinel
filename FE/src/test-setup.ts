import { configure } from '@testing-library/react'

/**
 * Mặc định `findBy*`/`waitFor` chỉ chờ 1 giây. Trên runner CI, các package (BE, FE, Gateway, Server) chạy song song
 * nên test đầu tiên của mỗi file (phải nạp lười cả trang) có thể quá 1 giây dù không có lỗi thật. Chờ rộng hơn
 * chỉ làm test thất bại chậm hơn khi có lỗi thật, không làm test đúng chậm đi (thấy phần tử là trả về ngay).
 */
configure({ asyncUtilTimeout: 5000 })
