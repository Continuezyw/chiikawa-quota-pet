const LINES = {
  chiikawa: ['哇……今天也一起加油吧！', '被摸摸了，好开心呀。', '工作一会儿，也记得休息哦。', '小小一只，认真陪你。'],
  hachiware: ['原来如此！我会一直陪着你！', '今天也要一起努力！', '来喝口水，再继续吧。', '遇到难题，我们慢慢来！'],
  usagi: ['呀哈！', '乌拉！乌拉！', '哈——？休息时间到啦！', '呀哈！今天也元气满满！'],
  kurimanju: ['呼啊……歇一会儿吧。', '忙完这一段，喝口水。', '慢慢来，别太累。'],
  momonga: ['快看我！是不是超可爱？', '再摸摸我嘛！', '今天也要多多夸我哦。'],
  rakko: ['专心做事，也别忘了休息。', '做得不错，继续前进吧。', '先把眼前这一步做好。'],
  shisa: ['今天也请多多关照！', '认真努力的你，很棒哦！', '休息一下，元气会回来！'],
  furuhonya: ['安静地陪你一会儿。', '来读点喜欢的东西吧。', '一点一点，今天也在进步。'],
  custom: ['我在这里陪着你。', '记得喝水，休息一下哦。', '今天也一起加油吧！']
};

function chooseDialogue(character, quota, sequence = 0) {
  const lines = LINES[character] || LINES.custom;
  const index = Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : 0;
  if (index % 5 === 4 && quota?.kind === 'quota' && Number.isFinite(quota.percentage) && quota.percentage >= 80) return '额度快用完啦，我会帮你留意。';
  return lines[index % lines.length];
}

module.exports = {chooseDialogue};
