import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendReviewEmail(post) {
  const reviewUrl = `${process.env.SITE_URL}/review?slug=${encodeURIComponent(post.slug)}&token=${encodeURIComponent(process.env.REVIEW_TOKEN)}`;

  return resend.emails.send({
    from: process.env.FROM_EMAIL,
    to: [process.env.OWNER_EMAIL],
    subject: `Yeni blog taslağı hazır: ${post.title}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
        <h2>Yeni blog taslağı hazır</h2>
        <p><strong>Başlık:</strong> ${post.title}</p>
        <p><strong>Kategori:</strong> ${post.category}</p>
        <p>${post.excerpt}</p>
        <p>İnceleyip onaylamak veya reddetmek için aşağıdaki bağlantıyı kullan:</p>
        <p><a href="${reviewUrl}">Taslağı aç</a></p>
      </div>
    `
  });
}
