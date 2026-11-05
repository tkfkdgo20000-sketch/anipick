
export async function onRequest({ request }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "");

  const allowed = [
    "schedules",
    "seasons/now",
    "top/anime"
  ];

  let endpoint = "";

  if (allowed.includes(path)) {
    endpoint = path;
  } else if (/^anime\/\d+$/.test(path)) {
    endpoint = path;
  } else {
    return Response.json(
      { error: "지원하지 않는 API 경로입니다." },
      { status: 404 }
    );
  }

  const upstream = new URL(
    `https://api.jikan.moe/v4/${endpoint}`
  );

  for (const key of [
    "page", "limit", "filter", "q", "sfw"
  ]) {
    const value = url.searchParams.get(key);
    if (value !== null) {
      upstream.searchParams.set(key, value);
    }
  }

  try {
    const response = await fetch(upstream.toString(), {
      headers: {
        Accept: "application/json"
      },
      cf: {
        cacheTtl: 300,
        cacheEverything: true
      }
    });

    const body = await response.text();

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return Response.json(
        { error: "외부 API 응답이 JSON이 아닙니다." },
        { status: 502 }
      );
    }

    return Response.json(data, {
      status: response.status,
      headers: {
        "Cache-Control": "public, max-age=300"
      }
    });

  } catch (error) {
    return Response.json(
      {
        error: "애니메이션 데이터를 가져오지 못했습니다."
      },
      { status: 502 }
    );
  }
}
