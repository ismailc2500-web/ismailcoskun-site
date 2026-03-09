import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateBlogPost() {
  const response = await client.responses.create({
    model: "gpt-5.4",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "Türkçe yaz. Kamu hukuku, anayasa hukuku, idare hukuku ve siyasi-hukuki analizler üzerine çalışan akademik bir araştırmacı için blog yazısı üret. Üslup ciddi, açık ve akademik olsun. Abartılı iddialardan kaçın. Çıktıyı geçerli JSON olarak ver. Şema: {title, excerpt, content, category}. content 700-1200 kelime arasında olsun. excerpt 2 cümleyi geçmesin."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Yeni yazı, Türkiye ve Birleşik Krallık karşılaştırmaları, anayasal devlet, yürütmenin sınırlandırılması, idarenin kanuniliği, hukuk devleti, siyasal kültür veya yargısal denetim eksenlerinden birinde olsun. Başlık özgün olsun."
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "blog_post",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["title", "excerpt", "content", "category"],
          properties: {
            title: { type: "string" },
            excerpt: { type: "string" },
            content: { type: "string" },
            category: { type: "string" }
          }
        }
      }
    }
  });

  return JSON.parse(response.output_text);
}
