export async function printMetrics(db) {
  const total = await db.collection("claims").countDocuments();
  const won = await db.collection("claims").countDocuments({ status: 200 });
  const lost = await db.collection("claims").countDocuments({ status: 409 });
  console.log(`📊 Claims total: ${total}, won: ${won}, lost: ${lost}`);
}


