import { useState, useCallback, useMemo, useRef, useEffect } from "react";

// ─── Data Model ───
const QUEST_DATA = {
  id: "quest_0042",
  name: "竜王の試練",
  chapter: "第3章 炎の記憶",
  ap_cost: 25,
  recommended_lv: 45,
  difficulty: "HARD",
  description: "伝説の竜王が眠る火山の奥深くへ。仲間との絆が試される最後の試練。",
  first_clear_rewards: [
    { id: "rw_001", name: "竜鱗の大剣", type: "装備", rarity: "SSR", quantity: 1 },
    { id: "rw_002", name: "聖晶石", type: "通貨", rarity: "SR", quantity: 50 },
    { id: "rw_003", name: "称号: 竜殺し", type: "称号", rarity: "SSR", quantity: 1 },
  ],
  drop_groups: [
    {
      id: "dg_01", name: "通常ドロップ", rate: "100%",
      drops: [
        { id: "dr_01", name: "竜の牙", rarity: "R", drop_rate: "45%", quantity: "1-3" },
        { id: "dr_02", name: "炎の結晶", rarity: "SR", drop_rate: "30%", quantity: "1-2" },
        { id: "dr_03", name: "マナの欠片", rarity: "N", drop_rate: "80%", quantity: "5-10" },
      ],
    },
    {
      id: "dg_02", name: "レアドロップ", rate: "25%",
      drops: [
        { id: "dr_04", name: "竜王の心核", rarity: "SSR", drop_rate: "5%", quantity: "1" },
        { id: "dr_05", name: "古代のルーン", rarity: "SR", drop_rate: "15%", quantity: "1" },
      ],
    },
  ],
  missions: [
    { id: "ms_01", name: "クリアする", reward: "聖晶石 x3", condition: "クエストクリア" },
    { id: "ms_02", name: "味方が誰も戦闘不能にならない", reward: "竜鱗の欠片 x5", condition: "戦闘不能0回" },
    { id: "ms_03", name: "20ターン以内にクリア", reward: "熟練の証 x1", condition: "ターン数 ≤ 20" },
  ],
  waves: [
    {
      id: "wv_01", name: "Wave 1", subtitle: "前衛の魔物たち",
      enemies: [
        {
          id: "en_01", name: "フレイムリザード", type: "normal", lv: 40, hp: 12000, atk: 350, def: 180,
          chara: { id: "ch_01", name: "リザード種", element: "火", class: "獣" },
          skills: [
            { id: "sk_01", name: "火炎ブレス", type: "攻撃", power: 280, target: "全体", cooldown: "3T", description: "前方に灼熱の息を吐く" },
            { id: "sk_02", name: "硬化鱗", type: "バフ", power: 0, target: "自身", cooldown: "5T", description: "DEFを40%アップ(3T)" },
          ],
        },
        {
          id: "en_02", name: "フレイムリザード", type: "normal", lv: 40, hp: 12000, atk: 350, def: 180,
          chara: { id: "ch_01", name: "リザード種", element: "火", class: "獣" },
          skills: [
            { id: "sk_01", name: "火炎ブレス", type: "攻撃", power: 280, target: "全体", cooldown: "3T", description: "前方に灼熱の息を吐く" },
            { id: "sk_02", name: "硬化鱗", type: "バフ", power: 0, target: "自身", cooldown: "5T", description: "DEFを40%アップ(3T)" },
          ],
        },
        {
          id: "en_03", name: "マグマスライム", type: "normal", lv: 38, hp: 8000, atk: 280, def: 100,
          chara: { id: "ch_02", name: "スライム種", element: "火", class: "不定形" },
          skills: [
            { id: "sk_03", name: "溶解液", type: "攻撃", power: 200, target: "単体", cooldown: "2T", description: "対象のDEFを20%ダウン" },
            { id: "sk_04", name: "分裂", type: "特殊", power: 0, target: "自身", cooldown: "∞", description: "HP50%以下で1回だけ発動。同個体を1体召喚" },
          ],
        },
      ],
    },
    {
      id: "wv_02", name: "Wave 2", subtitle: "竜の眷属",
      enemies: [
        {
          id: "en_04", name: "ドラゴンナイト", type: "normal", lv: 43, hp: 22000, atk: 500, def: 300,
          chara: { id: "ch_03", name: "竜騎士", element: "火", class: "人型" },
          skills: [
            { id: "sk_05", name: "竜槍突き", type: "攻撃", power: 420, target: "単体", cooldown: "2T", description: "高威力の単体攻撃" },
            { id: "sk_06", name: "竜の咆哮", type: "デバフ", power: 0, target: "全体", cooldown: "4T", description: "味方全体のATKを25%ダウン(2T)" },
            { id: "sk_07", name: "ドラゴンガード", type: "バフ", power: 0, target: "味方全体", cooldown: "6T", description: "味方全体のDEFを30%アップ(2T)" },
          ],
        },
        {
          id: "en_05", name: "炎の精霊", type: "normal", lv: 41, hp: 15000, atk: 420, def: 150,
          chara: { id: "ch_04", name: "精霊種", element: "火", class: "精霊" },
          skills: [
            { id: "sk_08", name: "イグニッション", type: "攻撃", power: 350, target: "全体", cooldown: "3T", description: "炎の波動で全体を焼く" },
            { id: "sk_09", name: "フレイムオーラ", type: "バフ", power: 0, target: "味方全体", cooldown: "5T", description: "味方全体のATKを20%アップ(3T)" },
          ],
        },
      ],
    },
    {
      id: "wv_03", name: "Wave 3", subtitle: "竜王降臨",
      enemies: [
        {
          id: "en_06", name: "竜王ヴァルハザク", type: "boss", lv: 50, hp: 120000, atk: 800, def: 450,
          chara: { id: "ch_05", name: "古龍種", element: "火", class: "竜" },
          skills: [
            { id: "sk_10", name: "滅龍炎", type: "攻撃", power: 900, target: "全体", cooldown: "5T", description: "最大火力の全体攻撃。火傷付与(3T)" },
            { id: "sk_11", name: "竜王の威圧", type: "デバフ", power: 0, target: "全体", cooldown: "3T", description: "全体のATK/DEFを30%ダウン(2T)" },
            { id: "sk_12", name: "再生の鱗", type: "回復", power: 0, target: "自身", cooldown: "4T", description: "HPを15%回復" },
            { id: "sk_13", name: "溶岩召喚", type: "特殊", power: 0, target: "フィールド", cooldown: "6T", description: "毎ターン全体に固定ダメージ500(3T)" },
            { id: "sk_14", name: "逆鱗", type: "攻撃", power: 1200, target: "単体", cooldown: "∞", description: "HP30%以下で発動。超高威力の即死級攻撃" },
          ],
        },
      ],
    },
  ],
};

// ─── Design Tokens ───
const palette = {
  bg: "#0C0B0F",
  surface: "#16151B",
  surfaceHover: "#1E1D25",
  surfaceActive: "#26252E",
  border: "rgba(255,255,255,0.06)",
  borderHover: "rgba(255,255,255,0.12)",
  text: "#E8E6F0",
  textMuted: "#8B8898",
  textDim: "#5C5969",
  accent: "#C4A1FF",
  accentDim: "rgba(196,161,255,0.12)",
  accentBorder: "rgba(196,161,255,0.25)",
  danger: "#FF6B6B",
  dangerDim: "rgba(255,107,107,0.12)",
  warning: "#FFB86C",
  warningDim: "rgba(255,184,108,0.12)",
  success: "#6BFFB8",
  successDim: "rgba(107,255,184,0.12)",
  info: "#6BC5FF",
  infoDim: "rgba(107,197,255,0.12)",
};

const font = {
  display: "'DM Sans', 'Noto Sans JP', sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', monospace",
};

// ─── Micro Components ───
const Tag = ({ children, variant = "default" }) => {
  const styles = {
    SSR: { bg: palette.dangerDim, color: palette.danger, border: `1px solid rgba(255,107,107,0.2)` },
    SR: { bg: palette.warningDim, color: palette.warning, border: `1px solid rgba(255,184,108,0.2)` },
    R: { bg: palette.infoDim, color: palette.info, border: `1px solid rgba(107,197,255,0.2)` },
    N: { bg: "rgba(255,255,255,0.04)", color: palette.textMuted, border: `1px solid ${palette.border}` },
    boss: { bg: palette.dangerDim, color: palette.danger, border: `1px solid rgba(255,107,107,0.2)` },
    normal: { bg: "rgba(255,255,255,0.04)", color: palette.textMuted, border: `1px solid ${palette.border}` },
    attack: { bg: palette.dangerDim, color: palette.danger, border: `1px solid rgba(255,107,107,0.2)` },
    buff: { bg: palette.successDim, color: palette.success, border: `1px solid rgba(107,255,184,0.2)` },
    debuff: { bg: palette.warningDim, color: palette.warning, border: `1px solid rgba(255,184,108,0.2)` },
    heal: { bg: palette.successDim, color: palette.success, border: `1px solid rgba(107,255,184,0.2)` },
    special: { bg: palette.accentDim, color: palette.accent, border: `1px solid ${palette.accentBorder}` },
    hard: { bg: palette.dangerDim, color: palette.danger, border: `1px solid rgba(255,107,107,0.2)` },
    default: { bg: palette.accentDim, color: palette.accent, border: `1px solid ${palette.accentBorder}` },
  };
  const s = styles[variant] || styles.default;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      fontSize: 10, fontWeight: 600, letterSpacing: "0.5px",
      padding: "2px 8px", borderRadius: 4,
      background: s.bg, color: s.color, border: s.border,
      lineHeight: "16px", textTransform: "uppercase",
      fontFamily: font.mono,
    }}>
      {children}
    </span>
  );
};

const DepthBar = ({ depth, maxDepth = 5 }) => (
  <div style={{ display: "flex", gap: 3, marginBottom: 20 }}>
    {Array.from({ length: maxDepth }, (_, i) => (
      <div key={i} style={{
        width: i <= depth ? 24 : 6, height: 3, borderRadius: 2,
        background: i <= depth ? palette.accent : "rgba(255,255,255,0.06)",
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        opacity: i <= depth ? 1 - i * 0.12 : 0.4,
      }} />
    ))}
  </div>
);

const Field = ({ label, value, mono = false, tag = null }) => (
  <div style={{ flex: 1, minWidth: 0 }}>
    <div style={{
      fontSize: 11, color: palette.textDim, marginBottom: 4,
      letterSpacing: "0.3px", fontWeight: 500,
    }}>{label}</div>
    <div style={{
      fontSize: 13, padding: "8px 12px",
      background: "rgba(255,255,255,0.03)",
      borderRadius: 6, border: `1px solid ${palette.border}`,
      fontFamily: mono ? font.mono : font.display,
      color: mono ? palette.textMuted : palette.text,
      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      display: "flex", alignItems: "center", gap: 8,
    }}>
      {tag || value}
    </div>
  </div>
);

const FieldRow = ({ children }) => (
  <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>{children}</div>
);

const SectionLabel = ({ children }) => (
  <div style={{
    fontSize: 10, fontWeight: 600, letterSpacing: "1px",
    color: palette.textDim, textTransform: "uppercase",
    marginBottom: 12, marginTop: 4,
    fontFamily: font.mono,
  }}>{children}</div>
);

// ─── Accordion Section ───
const RefSection = ({ title, count, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 20 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 0",
          borderBottom: `1px solid ${palette.border}`,
          cursor: "pointer", userSelect: "none",
          transition: "opacity 0.15s",
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = 0.8}
        onMouseLeave={e => e.currentTarget.style.opacity = 1}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 500 }}>
          <span style={{
            display: "inline-block", fontSize: 11, color: palette.textDim,
            transition: "transform 0.2s ease",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
          }}>▸</span>
          {title}
          <span style={{
            fontSize: 10, fontFamily: font.mono,
            background: "rgba(255,255,255,0.04)", color: palette.textMuted,
            padding: "2px 8px", borderRadius: 10, fontWeight: 500,
          }}>{count}</span>
        </div>
      </div>
      <div style={{
        overflow: "hidden",
        maxHeight: open ? 3000 : 0,
        opacity: open ? 1 : 0,
        transition: "max-height 0.3s ease, opacity 0.2s ease",
      }}>
        <div style={{ padding: "8px 0" }}>{children}</div>
      </div>
    </div>
  );
};

// ─── Ref Item (clickable row) ───
const RefItem = ({ name, sub, tag, onClick }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderRadius: 8, cursor: "pointer",
        background: hover ? palette.surfaceHover : "transparent",
        transition: "background 0.12s", gap: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 8,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {name} {tag}
        </div>
        {sub && (
          <div style={{
            fontSize: 11, color: palette.textMuted, marginTop: 2,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{sub}</div>
        )}
      </div>
      <div style={{ fontSize: 11, color: palette.textDim, flexShrink: 0 }}>→</div>
    </div>
  );
};

// ─── Back Button ───
const BackButton = ({ onClick }) => (
  <button
    onClick={onClick}
    style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      fontSize: 12, color: palette.textMuted, background: "none",
      border: "none", cursor: "pointer", padding: "4px 0",
      marginBottom: 8, fontFamily: font.display,
      transition: "color 0.15s",
    }}
    onMouseEnter={e => e.currentTarget.style.color = palette.text}
    onMouseLeave={e => e.currentTarget.style.color = palette.textMuted}
  >
    ← 戻る
  </button>
);

// ─── Breadcrumb ───
const Breadcrumb = ({ stack, goTo }) => {
  if (stack.length <= 1) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      fontSize: 11, color: palette.textDim, flexWrap: "wrap",
      marginBottom: 16, lineHeight: "20px",
    }}>
      {stack.map((item, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {i > 0 && <span style={{ color: "rgba(255,255,255,0.15)" }}>/</span>}
          {i === stack.length - 1 ? (
            <span style={{ color: palette.accent, fontWeight: 500 }}>{item.label}</span>
          ) : (
            <span
              onClick={() => goTo(i)}
              style={{ cursor: "pointer", transition: "color 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.color = palette.text}
              onMouseLeave={e => e.currentTarget.style.color = palette.textDim}
            >{item.label}</span>
          )}
        </span>
      ))}
    </div>
  );
};

// ─── View: Quest (Root, Depth 0) ───
const QuestView = ({ data, push }) => (
  <div>
    <DepthBar depth={0} />
    <div style={{ marginBottom: 24, borderBottom: `1px solid ${palette.border}`, paddingBottom: 20 }}>
      <div style={{
        fontSize: 24, fontWeight: 600, letterSpacing: "-0.5px",
        marginBottom: 4, lineHeight: 1.2,
      }}>{data.name}</div>
      <div style={{ fontSize: 13, color: palette.textMuted }}>{data.chapter}</div>
    </div>
    <SectionLabel>基本情報</SectionLabel>
    <FieldRow>
      <Field label="ID" value={data.id} mono />
      <Field label="難易度" value="" tag={<Tag variant="hard">{data.difficulty}</Tag>} />
    </FieldRow>
    <FieldRow>
      <Field label="消費AP" value={data.ap_cost} />
      <Field label="推奨Lv" value={data.recommended_lv} />
    </FieldRow>
    <FieldRow>
      <Field label="説明" value={data.description} />
    </FieldRow>

    <RefSection title="初回クリア報酬" count={data.first_clear_rewards.length}>
      {data.first_clear_rewards.map(r => (
        <RefItem
          key={r.id}
          name={r.name}
          tag={<Tag variant={r.rarity}>{r.rarity}</Tag>}
          sub={`${r.type} — x${r.quantity}`}
          onClick={() => push({ type: "reward", data: r, label: r.name, depth: 1 })}
        />
      ))}
    </RefSection>

    <RefSection title="ドロップ報酬グループ" count={data.drop_groups.length}>
      {data.drop_groups.map(g => (
        <RefItem
          key={g.id}
          name={g.name}
          sub={`出現率 ${g.rate} — ${g.drops.length}種のドロップ`}
          onClick={() => push({ type: "drop_group", data: g, label: g.name, depth: 1 })}
        />
      ))}
    </RefSection>

    <RefSection title="ミッション" count={data.missions.length}>
      {data.missions.map(m => (
        <RefItem
          key={m.id}
          name={m.name}
          sub={`${m.condition} → ${m.reward}`}
          onClick={() => push({ type: "mission", data: m, label: m.name, depth: 1 })}
        />
      ))}
    </RefSection>

    <RefSection title="Wave設定" count={data.waves.length}>
      {data.waves.map(w => {
        const bossCount = w.enemies.filter(e => e.type === "boss").length;
        return (
          <RefItem
            key={w.id}
            name={`${w.name} — ${w.subtitle}`}
            tag={bossCount > 0 ? <Tag variant="boss">BOSS</Tag> : null}
            sub={`${w.enemies.length}体の敵`}
            onClick={() => push({ type: "wave", data: w, label: w.name, depth: 1 })}
          />
        );
      })}
    </RefSection>
  </div>
);

// ─── View: Reward (Depth 1) ───
const RewardView = ({ data }) => (
  <div>
    <DepthBar depth={1} />
    <SectionLabel>報酬詳細</SectionLabel>
    <FieldRow>
      <Field label="ID" value={data.id} mono />
      <Field label="レアリティ" value="" tag={<Tag variant={data.rarity}>{data.rarity}</Tag>} />
    </FieldRow>
    <FieldRow>
      <Field label="名前" value={data.name} />
      <Field label="タイプ" value={data.type} />
    </FieldRow>
    <FieldRow>
      <Field label="個数" value={data.quantity} />
    </FieldRow>
  </div>
);

// ─── View: DropGroup (Depth 1) ───
const DropGroupView = ({ data, push }) => (
  <div>
    <DepthBar depth={1} />
    <SectionLabel>ドロップグループ</SectionLabel>
    <FieldRow>
      <Field label="ID" value={data.id} mono />
      <Field label="出現率" value={data.rate} />
    </FieldRow>
    <FieldRow>
      <Field label="名前" value={data.name} />
    </FieldRow>
    <RefSection title="ドロップ報酬" count={data.drops.length} defaultOpen>
      {data.drops.map(d => (
        <RefItem
          key={d.id}
          name={d.name}
          tag={<Tag variant={d.rarity}>{d.rarity}</Tag>}
          sub={`ドロップ率 ${d.drop_rate} — x${d.quantity}`}
          onClick={() => push({ type: "drop", data: d, label: d.name, depth: 2 })}
        />
      ))}
    </RefSection>
  </div>
);

// ─── View: Drop (Depth 2) ───
const DropView = ({ data }) => (
  <div>
    <DepthBar depth={2} />
    <SectionLabel>ドロップ報酬詳細</SectionLabel>
    <FieldRow>
      <Field label="ID" value={data.id} mono />
      <Field label="レアリティ" value="" tag={<Tag variant={data.rarity}>{data.rarity}</Tag>} />
    </FieldRow>
    <FieldRow>
      <Field label="名前" value={data.name} />
      <Field label="ドロップ率" value={data.drop_rate} />
    </FieldRow>
    <FieldRow>
      <Field label="個数" value={data.quantity} />
    </FieldRow>
  </div>
);

// ─── View: Mission (Depth 1) ───
const MissionView = ({ data }) => (
  <div>
    <DepthBar depth={1} />
    <SectionLabel>ミッション詳細</SectionLabel>
    <FieldRow><Field label="ID" value={data.id} mono /></FieldRow>
    <FieldRow><Field label="名前" value={data.name} /></FieldRow>
    <FieldRow><Field label="条件" value={data.condition} /></FieldRow>
    <FieldRow><Field label="報酬" value={data.reward} /></FieldRow>
  </div>
);

// ─── View: Wave (Depth 1) ───
const WaveView = ({ data, push }) => (
  <div>
    <DepthBar depth={1} />
    <SectionLabel>Wave情報</SectionLabel>
    <FieldRow>
      <Field label="ID" value={data.id} mono />
      <Field label="名前" value={data.name} />
    </FieldRow>
    <FieldRow>
      <Field label="サブタイトル" value={data.subtitle} />
    </FieldRow>
    <RefSection title="エネミー" count={data.enemies.length} defaultOpen>
      {data.enemies.map((e, i) => (
        <RefItem
          key={`${e.id}-${i}`}
          name={e.name}
          tag={<Tag variant={e.type}>{e.type === "boss" ? "BOSS" : "通常"}</Tag>}
          sub={`Lv.${e.lv} — HP ${e.hp.toLocaleString()} — ${e.chara.element}属性 / ${e.chara.class}`}
          onClick={() => push({ type: "enemy", data: e, label: e.name, depth: 2 })}
        />
      ))}
    </RefSection>
  </div>
);

// ─── View: Enemy (Depth 2) ───
const EnemyView = ({ data, push }) => {
  const skillVariant = (t) => {
    const m = { "攻撃": "attack", "バフ": "buff", "デバフ": "debuff", "回復": "heal", "特殊": "special" };
    return m[t] || "default";
  };
  return (
    <div>
      <DepthBar depth={2} />
      <SectionLabel>エネミー情報</SectionLabel>
      <FieldRow>
        <Field label="ID" value={data.id} mono />
        <Field label="タイプ" value="" tag={<Tag variant={data.type}>{data.type === "boss" ? "BOSS" : "通常"}</Tag>} />
      </FieldRow>
      <FieldRow>
        <Field label="名前" value={data.name} />
        <Field label="Lv" value={data.lv} />
      </FieldRow>
      <FieldRow>
        <Field label="HP" value={data.hp.toLocaleString()} />
        <Field label="ATK" value={data.atk} />
        <Field label="DEF" value={data.def} />
      </FieldRow>

      <RefSection title="依存キャラ" count={1} defaultOpen>
        <RefItem
          name={data.chara.name}
          sub={`${data.chara.element}属性 / ${data.chara.class}`}
          onClick={() => push({ type: "chara", data: data.chara, label: data.chara.name, depth: 3 })}
        />
      </RefSection>

      <RefSection title="スキル" count={data.skills.length} defaultOpen>
        {data.skills.map(s => (
          <RefItem
            key={s.id}
            name={s.name}
            tag={<Tag variant={skillVariant(s.type)}>{s.type}</Tag>}
            sub={`威力${s.power || "—"} / ${s.target} / CT:${s.cooldown}`}
            onClick={() => push({ type: "skill", data: s, label: s.name, depth: 3 })}
          />
        ))}
      </RefSection>
    </div>
  );
};

// ─── View: Chara (Depth 3) ───
const CharaView = ({ data }) => (
  <div>
    <DepthBar depth={3} />
    <SectionLabel>キャラ情報</SectionLabel>
    <FieldRow><Field label="ID" value={data.id} mono /></FieldRow>
    <FieldRow>
      <Field label="名前" value={data.name} />
      <Field label="属性" value={data.element} />
    </FieldRow>
    <FieldRow><Field label="クラス" value={data.class} /></FieldRow>
  </div>
);

// ─── View: Skill (Depth 3) ───
const SkillView = ({ data }) => {
  const skillVariant = (t) => {
    const m = { "攻撃": "attack", "バフ": "buff", "デバフ": "debuff", "回復": "heal", "特殊": "special" };
    return m[t] || "default";
  };
  return (
    <div>
      <DepthBar depth={3} />
      <SectionLabel>スキル詳細</SectionLabel>
      <FieldRow>
        <Field label="ID" value={data.id} mono />
        <Field label="タイプ" value="" tag={<Tag variant={skillVariant(data.type)}>{data.type}</Tag>} />
      </FieldRow>
      <FieldRow>
        <Field label="名前" value={data.name} />
        <Field label="威力" value={data.power || "—"} />
      </FieldRow>
      <FieldRow>
        <Field label="対象" value={data.target} />
        <Field label="クールダウン" value={data.cooldown} />
      </FieldRow>
      <FieldRow>
        <Field label="説明" value={data.description} />
      </FieldRow>
    </div>
  );
};

// ─── Main App ───
export default function QuestFormViewer() {
  const [navStack, setNavStack] = useState([
    { type: "quest", data: QUEST_DATA, label: "竜王の試練", depth: 0 },
  ]);
  const [fadeIn, setFadeIn] = useState(true);
  const containerRef = useRef(null);

  const push = useCallback((view) => {
    setFadeIn(false);
    setTimeout(() => {
      setNavStack(prev => [...prev, view]);
      setFadeIn(true);
    }, 120);
  }, []);

  const goBack = useCallback(() => {
    if (navStack.length <= 1) return;
    setFadeIn(false);
    setTimeout(() => {
      setNavStack(prev => prev.slice(0, -1));
      setFadeIn(true);
    }, 120);
  }, [navStack.length]);

  const goTo = useCallback((idx) => {
    setFadeIn(false);
    setTimeout(() => {
      setNavStack(prev => prev.slice(0, idx + 1));
      setFadeIn(true);
    }, 120);
  }, []);

  const current = navStack[navStack.length - 1];

  const renderView = () => {
    switch (current.type) {
      case "quest": return <QuestView data={current.data} push={push} />;
      case "reward": return <RewardView data={current.data} />;
      case "drop_group": return <DropGroupView data={current.data} push={push} />;
      case "drop": return <DropView data={current.data} />;
      case "mission": return <MissionView data={current.data} />;
      case "wave": return <WaveView data={current.data} push={push} />;
      case "enemy": return <EnemyView data={current.data} push={push} />;
      case "chara": return <CharaView data={current.data} />;
      case "skill": return <SkillView data={current.data} />;
      default: return null;
    }
  };

  return (
    <div style={{
      fontFamily: font.display,
      color: palette.text,
      background: palette.bg,
      minHeight: "100vh",
      padding: "32px 24px",
    }}>
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Noto+Sans+JP:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <div style={{ maxWidth: 620, margin: "0 auto" }} ref={containerRef}>
        {/* Tiny top label */}
        <div style={{
          fontSize: 10, fontFamily: font.mono, color: palette.textDim,
          letterSpacing: "1.5px", textTransform: "uppercase",
          marginBottom: 24, display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: palette.accent, display: "inline-block",
            boxShadow: `0 0 8px ${palette.accent}`,
          }} />
          Entity form viewer
        </div>

        {navStack.length > 1 && <BackButton onClick={goBack} />}
        <Breadcrumb stack={navStack} goTo={goTo} />

        <div style={{
          opacity: fadeIn ? 1 : 0,
          transform: fadeIn ? "translateY(0)" : "translateY(8px)",
          transition: "opacity 0.2s ease, transform 0.2s ease",
        }}>
          {renderView()}
        </div>

        {/* Footer */}
        <div style={{
          marginTop: 48, paddingTop: 20,
          borderTop: `1px solid ${palette.border}`,
          fontSize: 10, color: palette.textDim,
          fontFamily: font.mono, letterSpacing: "0.5px",
          display: "flex", justifyContent: "space-between",
        }}>
          <span>depth: {current.depth}/4</span>
          <span>entities: {navStack.length}</span>
        </div>
      </div>
    </div>
  );
}