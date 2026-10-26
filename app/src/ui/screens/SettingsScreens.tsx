import React, { useMemo, useState } from 'react';
import { Alert, Linking, Platform, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { useApp } from '../AppProvider';
import { Button, Card, Chip, ErrorState, Field, ListTile, Row, Screen, SectionHeader } from '../components';
import { colors, spacing, typography } from '../theme';
import { updateBaby, validateBirthDate } from '../../domain/repositories/babies';
import {
  BackupRejected,
  BackupSummary,
  exportBackup,
  inspectBackup,
  restoreBackup,
  serialiseBackup,
} from '../../domain/backup';
import { REGIONS, regionInfo, PACK_VERSIONS } from '../../data/loadPacks';
import { SCHEMA_VERSION } from '../../db/migrations';
import { Region, REVIEW_LABELS, Sex, SourceRecord } from '../../domain/types';
import { deviceTimezone } from '../../domain/time';
import appJson from '../../../app.json';

const APP_VERSION: string = (appJson as { expo: { version: string } }).expo.version;

export function BabyProfileScreen() {
  const { db, baby, refresh } = useApp();
  const [name, setName] = useState(baby.name ?? '');
  const [birth, setBirth] = useState(baby.birth_date ?? '');
  const [sex, setSex] = useState<Sex>(baby.sex);
  const [region, setRegion] = useState<Region>(baby.region as Region);
  const [tz, setTz] = useState(baby.timezone);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const info = regionInfo(region);

  return (
    <Screen>
      <Text style={typography.display}>宝宝信息</Text>
      <Text style={[typography.caption, { marginTop: spacing.xs, marginBottom: spacing.lg }]}>
        这些信息只保存在这台手机上，不会上传。留空也能正常记录，只是无法进行与月龄和 WHO 标准相关的比较。
      </Text>

      {!!error && <ErrorState detail={error} onRetry={() => setError(null)} />}

      <Card>
        <Field label="称呼（可不填）" value={name} onChangeText={setName} placeholder="例如 小满" />
        <Field
          label="出生日期"
          value={birth}
          onChangeText={setBirth}
          placeholder="YYYY-MM-DD"
          hint="用于计算月龄并对齐 WHO 参考曲线。"
        />
        <Text style={[typography.label, { marginBottom: spacing.sm }]}>性别</Text>
        <Row style={{ flexWrap: 'wrap', marginBottom: spacing.lg }}>
          {(
            [
              ['female', '女'],
              ['male', '男'],
              ['unknown', '不填写'],
            ] as const
          ).map(([k, l]) => (
            <Chip key={k} label={l} selected={sex === k} onPress={() => setSex(k)} />
          ))}
        </Row>
        <Text style={[typography.caption, { marginBottom: spacing.lg }]}>
          WHO 生长标准按男/女分别建立。选择「不填写」时，应用不会猜测，也不会显示参考分位。
        </Text>

        <Text style={[typography.label, { marginBottom: spacing.sm }]}>地区</Text>
        <Row style={{ flexWrap: 'wrap', marginBottom: spacing.md }}>
          {REGIONS.map((r) => (
            <Chip key={r.code} label={r.name_zh} selected={region === r.code} onPress={() => setRegion(r.code as Region)} />
          ))}
        </Row>
        {!!info && (
          <Card tone="alt">
            <Text style={typography.caption}>饮食背景：{info.dietary_context_note}</Text>
            <Text style={[typography.caption, { marginTop: spacing.xs }]}>数据留存：{info.data_jurisdiction}</Text>
            <Text style={[typography.caption, { marginTop: spacing.xs }]}>
              临床内容：{info.clinical_available ? '可用' : '不可用（当地临床内容尚未通过独立专业审核）'}
            </Text>
          </Card>
        )}

        <Field
          label="时区"
          value={tz}
          onChangeText={setTz}
          hint={`当前设备时区为 ${deviceTimezone()}。记录会按保存时的时区归入当天，之后改时区不会移动历史记录。`}
        />

        <Button
          label={saved ? '已保存' : '保存'}
          onPress={() => {
            setError(null);
            let birthValue: string | null = null;
            if (birth.trim() !== '') {
              const v = validateBirthDate(birth.trim());
              if (!v.ok) {
                setError(v.error);
                return;
              }
              birthValue = v.value;
            }
            updateBaby(db, baby.id, {
              name: name.trim() || null,
              birth_date: birthValue,
              sex,
              region,
              timezone: tz.trim() || deviceTimezone(),
            });
            setSaved(true);
            refresh();
          }}
        />
      </Card>
    </Screen>
  );
}

export function BackupScreen() {
  const { db, refresh } = useApp();
  const [pending, setPending] = useState<{ text: string; summary: BackupSummary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const doExport = async () => {
    setError(null);
    try {
      const text = serialiseBackup(exportBackup(db, APP_VERSION));
      const file = new File(Paths.cache, `bbeat-backup-${new Date().toISOString().slice(0, 10)}.json`);
      if (file.exists) file.delete();
      file.create();
      file.write(text);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: '导出 BB-Eat 备份' });
        setMessage('备份已生成，请在分享面板中选择保存位置。');
      } else {
        setMessage(`备份已保存到：${file.uri}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const doPick = async () => {
    setError(null);
    setMessage(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const text = await new File(res.assets[0].uri).text();
      const { summary } = inspectBackup(text);
      setPending({ text, summary });
    } catch (e) {
      setError(e instanceof BackupRejected ? e.message : e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen>
      <Text style={typography.display}>备份与恢复</Text>
      <Text style={[typography.caption, { marginTop: spacing.xs, marginBottom: spacing.lg }]}>
        备份文件只包含你自己录入的数据，保存在你选择的位置，不会上传到任何服务器。
      </Text>

      {!!error && <ErrorState detail={error} onRetry={() => setError(null)} />}
      {!!message && (
        <Card tone="alt">
          <Text style={typography.caption}>{message}</Text>
        </Card>
      )}

      <Card>
        <Text style={typography.section}>导出备份</Text>
        <Text style={[typography.caption, { marginTop: spacing.xs }]}>
          生成一个带校验值的 JSON 文件。内置的食材、食谱与 WHO 参考数据不包含在内，恢复时由应用自身重新载入。
        </Text>
        <Button label="导出" style={{ marginTop: spacing.md }} onPress={doExport} />
      </Card>

      <Card>
        <Text style={typography.section}>从备份恢复</Text>
        <Text style={[typography.caption, { marginTop: spacing.xs }]}>
          恢复会用备份内容替换这台手机上的全部记录。应用会先校验文件完整性，并让你确认后再写入。
        </Text>
        <Button label="选择备份文件" variant="secondary" style={{ marginTop: spacing.md }} onPress={doPick} />
      </Card>

      {!!pending && (
        <Card tone="warn">
          <Text style={typography.section}>确认恢复</Text>
          <Text style={[typography.caption, { marginTop: spacing.sm }]}>
            导出时间：{pending.summary.exported_at}
          </Text>
          <Text style={typography.caption}>应用版本：{pending.summary.app_version}</Text>
          <Text style={typography.caption}>记录总条数：{pending.summary.total_rows}</Text>
          <Text style={typography.caption}>
            记录日期范围：{pending.summary.earliest_record ?? '无'} ~ {pending.summary.latest_record ?? '无'}
          </Text>
          {pending.summary.babies.map((b) => (
            <Text key={b.id} style={typography.caption}>
              宝宝：{b.name ?? '未命名'}（出生 {b.birth_date ?? '未填写'}）
            </Text>
          ))}
          <Text style={[typography.body, { marginTop: spacing.md, color: colors.danger }]}>
            这台手机上现有的记录将被替换，且无法撤销。
          </Text>
          <Row style={{ marginTop: spacing.lg, flexWrap: 'wrap' }}>
            <Button
              label="取消"
              variant="ghost"
              style={{ marginRight: spacing.sm }}
              onPress={() => setPending(null)}
            />
            <Button
              label="确认恢复"
              variant="danger"
              onPress={() =>
                Alert.alert('确认恢复', '现有记录会被备份内容替换，无法撤销。', [
                  { text: '取消', style: 'cancel' },
                  {
                    text: '确认',
                    style: 'destructive',
                    onPress: () => {
                      try {
                        const report = restoreBackup(db, pending.text);
                        setPending(null);
                        setMessage(`已恢复 ${report.total_rows} 条记录。`);
                        refresh();
                      } catch (e) {
                        setPending(null);
                        setError(e instanceof BackupRejected ? e.message : String(e));
                      }
                    },
                  },
                ])
              }
            />
          </Row>
        </Card>
      )}
    </Screen>
  );
}

export function SourcesScreen() {
  const { db, revision } = useApp();
  const sources = useMemo(
    () => db.all<SourceRecord>('SELECT * FROM sources ORDER BY publisher, title'),
    [db, revision],
  );

  return (
    <Screen>
      <Text style={typography.display}>资料来源与审核状态</Text>
      <Text style={[typography.caption, { marginTop: spacing.xs, marginBottom: spacing.lg }]}>
        这里如实列出每一条内置资料的出处、许可与当前审核状态，包括没有取得、或无法合法内置的部分。
      </Text>

      <Card tone="warn">
        <Text style={typography.bodyStrong}>没有任何内容通过外部医学专业审核</Text>
        <Text style={[typography.caption, { marginTop: spacing.xs }]}>
          本应用由程序生成与校验，不具备医学审核资质。因此不提供个性化健康建议、不判定过敏、不给出单一食材的起始月龄。
        </Text>
      </Card>

      {sources.map((s) => (
        <Card key={s.id}>
          <Text style={typography.bodyStrong}>{s.title}</Text>
          <Text style={[typography.caption, { marginTop: 2 }]}>{s.publisher}</Text>
          <Row style={{ flexWrap: 'wrap', marginTop: spacing.sm }}>
            <Chip label={REVIEW_LABELS[s.review_status] ?? s.review_status} />
            <Chip
              label={
                s.redistributable === 'yes'
                  ? '可内置'
                  : s.redistributable === 'metadata_only'
                    ? '仅链接'
                    : s.redistributable === 'no'
                      ? '不可内置'
                      : '许可不明'
              }
              tone={s.redistributable === 'yes' ? 'neutral' : 'warn'}
            />
            {!!s.region && <Chip label={s.region} />}
          </Row>
          {!!s.claim_scope && (
            <Text style={[typography.caption, { marginTop: spacing.sm }]}>引用范围：{s.claim_scope}</Text>
          )}
          {!!s.license && <Text style={[typography.caption, { marginTop: 2 }]}>许可：{s.license}</Text>}
          {!!s.attribution && <Text style={[typography.caption, { marginTop: 2 }]}>{s.attribution}</Text>}
          <Text style={[typography.caption, { marginTop: spacing.sm, color: colors.info }]} onPress={() => Linking.openURL(s.source_url).catch(() => undefined)}>
            {s.source_url}
          </Text>
          <Text style={[typography.caption, { marginTop: 2 }]}>
            最后核验：{s.last_verified ?? s.retrieved_at ?? '未记录'}
          </Text>
        </Card>
      ))}

      <SectionHeader title="版本信息" />
      <Card tone="alt">
        <Text style={typography.caption}>应用版本 {APP_VERSION}（{Platform.OS}）</Text>
        <Text style={typography.caption}>数据库结构版本 {SCHEMA_VERSION}</Text>
        {Object.entries(PACK_VERSIONS).map(([k, v]) => (
          <Text key={k} style={typography.caption}>
            知识包 {k}：{v}
          </Text>
        ))}
      </Card>
    </Screen>
  );
}

export function PrivacyScreen({ navigation }: { navigation: { navigate: (s: string) => void } }) {
  const { db, baby, refresh } = useApp();
  return (
    <Screen>
      <Text style={typography.display}>隐私与数据</Text>

      <Card>
        <Text style={typography.section}>数据存在哪里</Text>
        <Text style={[typography.body, { marginTop: spacing.sm }]}>
          全部记录保存在这台手机的本地数据库中。应用不含账号系统，不会把宝宝信息、进食记录或测量数据发送到任何服务器。
        </Text>
      </Card>

      <Card>
        <Text style={typography.section}>这个应用不做什么</Text>
        {[
          '不提供诊断，也不判定是否过敏。',
          '不在缺少依据时给出个性化健康建议。',
          '不把「不详」当作 0 计入统计。',
          '不把计划当作已经吃过。',
          '不根据一次测量得出健康结论。',
        ].map((t, i) => (
          <Text key={i} style={[typography.body, { marginTop: spacing.sm }]}>
            · {t}
          </Text>
        ))}
      </Card>

      <Card>
        <Text style={typography.section}>紧急情况</Text>
        <Text style={[typography.body, { marginTop: spacing.sm }]}>
          如果宝宝出现呼吸困难、持续呕吐、面部肿胀、意识变化等情况，请立即就医或拨打当地急救电话。本应用不能替代医疗服务。
        </Text>
      </Card>

      <SectionHeader title="管理我的数据" />
      <Card>
        <ListTile
          title="备份与恢复"
          subtitle="导出或导入本地数据文件"
          onPress={() => navigation.navigate('Backup')}
        />
        <ListTile
          title="资料来源与审核状态"
          subtitle="每条内置资料的出处与许可"
          onPress={() => navigation.navigate('Sources')}
        />
      </Card>

      <Card tone="warn">
        <Text style={typography.section}>删除全部记录</Text>
        <Text style={[typography.caption, { marginTop: spacing.xs }]}>
          会清除这台手机上的全部记录，无法撤销。建议先导出备份。
        </Text>
        <Button
          label="删除全部记录"
          variant="danger"
          style={{ marginTop: spacing.md }}
          onPress={() =>
            Alert.alert('删除全部记录', '所有进食、奶量、观察与测量记录都会被删除，且无法撤销。', [
              { text: '取消', style: 'cancel' },
              {
                text: '删除',
                style: 'destructive',
                onPress: () => {
                  db.transaction(() => {
                    for (const t of [
                      'feeding_event_ingredients',
                      'feeding_events',
                      'liquid_events',
                      'exposure_events',
                      'symptom_observations',
                      'caregiver_suspicions',
                      'reported_clinical_notes',
                      'growth_measurements',
                      'plan_items',
                      'meal_slots',
                      'inventory_items',
                      'audit_log',
                    ]) {
                      db.run(`DELETE FROM ${t} WHERE 1 = 1`);
                    }
                    db.run("UPDATE babies SET birth_date = NULL, sex = 'unknown', name = NULL WHERE id = ?", [
                      baby.id,
                    ]);
                  });
                  refresh();
                },
              },
            ])
          }
        />
      </Card>

      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}
