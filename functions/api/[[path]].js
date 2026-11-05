
const DAY_NAMES = {
  monday: "Mondays",
  tuesday: "Tuesdays",
  wednesday: "Wednesdays",
  thursday: "Thursdays",
  friday: "Fridays",
  saturday: "Saturdays",
  sunday: "Sundays"
};

function convertAnime(a) {
  return {
    mal_id: a.id,
    title: a.title,
    title_japanese: a.titleJapanese || "",
    broadcast: {
      day: DAY_NAMES[a.day] || "",
      time: a.time || ""
    },
    genres: (a.genres || []).map(name => ({ name })),
    score: a.score || null,
    status: a.status === "airing"
      ? "Currently Airing"
      : a.status === "finished"
        ? "Finished Airing"
        : "Unknown",
    year: a.year || null,
    episodes: a.episodes || null,
    synopsis: a.synopsis || "",
    images: {
      jpg: {
        large_image_url: a.image || ""
      }
    },
    url: a.url || ""
  };
}

export async function onRequest({ request, env }) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/?/, "");
    const dataUrl = new URL("/anime-data.json", url.origin);

    const response = await env.ASSETS.fetch(
      new Request(dataUrl.toString())
    );

    if (!response.ok) {
      throw new Error("anime-data.json 파일을 찾을 수 없습니다.");
    }

    const json = await response.json();
    let anime = Array.isArray(json.anime) ? json.anime : [];

    if (/^anime\/[^/]+\/streaming$/.test(path)) {
      return Response.json({ data: [] });
    }

    if (path === "top/anime") {
      anime = [...anime].sort(
        (a, b) => (b.score || 0) - (a.score || 0)
      );
    } else if (path === "schedules") {
      anime = anime.filter(a => a.status === "airing");
    } else if (path === "anime") {
      const status = url.searchParams.get("status");
      if (status === "complete") {
        anime = anime.filter(a => a.status === "finished");
      }
    } else {
      return Response.json(
        { error: "지원하지 않는 API 경로입니다." },
        { status: 404 }
      );
    }

    const q = (url.searchParams.get("q") || "").toLowerCase();

    if (q) {
      anime = anime.filter(a =>
        [a.title, a.titleJapanese]
          .some(s => String(s || "").toLowerCase().includes(q))
      );
    }

    const page = Math.max(
      1, Number(url.searchParams.get("page")) || 1
    );
    const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("limit")) || 25)
    );

    const start = (page - 1) * limit;
    const results = anime.slice(start, start + limit);

    return Response.json({
      data: results.map(convertAnime),
      pagination: {
        has_next_page: start + limit < anime.length
      }
    }, {
      headers: {
        "Cache-Control": "public, max-age=60"
      }
    });
  } catch (error) {
    return Response.json({
      error: "AniPick 데이터 연결 오류",
      detail: error.message
    }, { status: 500 });
  }
}
