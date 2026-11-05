
const ENDPOINT = 'https://graphql.anilist.co';

const DAYS = [
  'Sundays', 'Mondays', 'Tuesdays', 'Wednesdays',
  'Thursdays', 'Fridays', 'Saturdays'
];

const MEDIA_FIELDS = `
  id
  title { romaji english native }
  coverImage { large extraLarge }
  siteUrl
  description(asHtml:false)
  genres
  averageScore
  episodes
  status
  seasonYear
  startDate { year }
  nextAiringEpisode { airingAt }
  airingSchedule(notYetAired:false, perPage:10) {
    nodes { airingAt }
  }
  externalLinks { site url type }
`;

const QUERY = `
  query (
    $page:Int, $perPage:Int, $search:String,
    $sort:[MediaSort], $status:MediaStatus,
    $season:MediaSeason, $seasonYear:Int
  ) {
    Page(page:$page,perPage:$perPage) {
      pageInfo { hasNextPage }
      media(
        type:ANIME, isAdult:false, search:$search,
        sort:$sort, status:$status,
        season:$season, seasonYear:$seasonYear
      ) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

const DETAILS = `
  query ($id:Int) {
    Media(id:$id,type:ANIME) {
      ${MEDIA_FIELDS}
    }
  }
`;

const AIRING = `
  query ($page:Int,$perPage:Int,$from:Int,$to:Int) {
    Page(page:$page,perPage:$perPage) {
      pageInfo { hasNextPage }
      airingSchedules(
        airingAt_greater:$from,
        airingAt_lesser:$to,
        sort:TIME
      ) {
        airingAt
        media {
          ${MEDIA_FIELDS}
        }
      }
    }
  }
`;

function stripMarkup(value) {
  return (value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jstDate(ts) {
  return new Date(ts * 1000 + 9 * 3600000);
}

function toItem(m, scheduledAt) {
  const times = [
    scheduledAt,
    ...(m.airingSchedule?.nodes || []).map(x => x.airingAt),
    m.nextAiringEpisode?.airingAt
  ].filter(Boolean);

  const t = times.length ? Math.min(...times) : null;
  const d = t ? jstDate(t) : null;

  const day = d ? DAYS[d.getUTCDay()] : null;
  const time = d
    ? `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
    : null;

  return {
    mal_id: m.id,
    title: m.title?.romaji || m.title?.native || '제목 미상',
    title_english: m.title?.english || null,
    broadcast: { day, time },
    genres: (m.genres || []).map(name => ({ name })),
    score: m.averageScore
      ? +(m.averageScore / 10).toFixed(1)
      : null,
    status: m.status === 'FINISHED'
      ? 'Finished Airing'
      : m.status === 'RELEASING'
        ? 'Currently Airing'
        : m.status || '',
    episodes: m.episodes || null,
    year: m.seasonYear || m.startDate?.year || null,
    synopsis: stripMarkup(m.description),
    images: {
      jpg: {
        large_image_url:
          m.coverImage?.extraLarge || m.coverImage?.large || ''
      }
    },
    url: m.siteUrl || '',
    rating: '',
    _anilist_id: m.id,
    _externalLinks: m.externalLinks || []
  };
}

async function request(query, variables) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });

  const raw = await r.text();
  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`AniList returned non-JSON (HTTP ${r.status})`);
  }

  if (!r.ok || data.errors?.length) {
    throw new Error(
      data.errors?.[0]?.message || `AniList HTTP ${r.status}`
    );
  }

  return data.data;
}

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '');

  const page = Math.min(
    20, Math.max(1, Number(url.searchParams.get('page')) || 1)
  );
  const limit = Math.min(
    25, Math.max(1, Number(url.searchParams.get('limit')) || 25)
  );

  const params = { page, perPage: limit };

  try {
    let list = [];
    let hasNextPage = false;

    if (path === 'schedules') {
      const now = Date.now();
      const start = new Date(now + 9 * 3600000);
      start.setUTCHours(0, 0, 0, 0);

      const from = Math.floor(
        (start.getTime() - 9 * 3600000) / 1000
      ) - 1;
      const to = from + 7 * 86400 + 1;

      const result = await request(AIRING, {
        page, perPage: limit, from, to
      });

      const seen = new Set();

      list = (result.Page?.airingSchedules || [])
        .filter(x => x.media && !x.media.isAdult)
        .map(x => toItem(x.media, x.airingAt))
        .filter(x => {
          if (seen.has(x.mal_id)) return false;
          seen.add(x.mal_id);
          return true;
        });

      hasNextPage = Boolean(
        result.Page?.pageInfo?.hasNextPage
      );

    } else if (
      path === 'anime' ||
      path === 'top/anime' ||
      path === 'seasons/now'
    ) {
      const q = url.searchParams.get('q');
      if (q) params.search = q;

      if (path === 'top/anime') {
        params.sort = ['POPULARITY_DESC'];
      } else if (
        url.searchParams.get('status') === 'complete'
      ) {
        params.status = 'FINISHED';
        params.sort = ['SCORE_DESC'];
      } else {
        params.sort = ['TRENDING_DESC'];
      }

      if (path === 'seasons/now') {
        const d = jstDate(Math.floor(Date.now() / 1000));
        const month = d.getUTCMonth() + 1;

        params.season = month <= 3
          ? 'WINTER'
          : month <= 6
            ? 'SPRING'
            : month <= 9
              ? 'SUMMER'
              : 'FALL';

        params.seasonYear = d.getUTCFullYear();
      }

      const result = await request(QUERY, params);

      list = (result.Page?.media || []).map(x => toItem(x));
      hasNextPage = Boolean(
        result.Page?.pageInfo?.hasNextPage
      );

    } else if (/^anime\/\d+\/streaming$/.test(path)) {
      const id = Number(path.split('/')[1]);
      const result = await request(DETAILS, { id });

      const links = (result.Media?.externalLinks || [])
        .filter(x => x.url && /streaming/i.test(x.type || ''));

      return Response.json({
        data: links.map(x => ({
          name: x.site,
          url: x.url
        }))
      }, {
        headers: { 'Cache-Control': 'public, max-age=300' }
      });

    } else if (/^anime\/\d+$/.test(path)) {
      const result = await request(DETAILS, {
        id: Number(path.split('/')[1])
      });

      return Response.json({
        data: result.Media ? toItem(result.Media) : null
      }, {
        headers: { 'Cache-Control': 'public, max-age=300' }
      });

    } else {
      return Response.json({
        error: '지원하지 않는 API 경로입니다.'
      }, { status: 404 });
    }

    return Response.json({
      data: list,
      pagination: { has_next_page: hasNextPage },
      source: 'AniList',
      timezone: 'Asia/Tokyo'
    }, {
      headers: { 'Cache-Control': 'public, max-age=300' }
    });

  } catch (e) {
    return Response.json({
      error: 'AniList 연결 오류',
      detail: String(e.message || e)
    }, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}

