
export async function onRequest(context) {
  return Response.json({
    success: true,
    message: "AniPick API 연결 성공"
  });
}
