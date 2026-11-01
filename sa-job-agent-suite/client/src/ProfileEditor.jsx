import { Briefcase, GraduationCap, Languages, MapPin, Sliders, Wallet } from 'lucide-react';

const text = (value) => (typeof value === 'string' ? value : '');
const list = (value) => (Array.isArray(value) ? value : []);

function Field({ label, value, onChange, type = 'text', hint, placeholder }) {
  return (
    <div>
      <label>{label}</label>
      <input
        type={type}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(event) => onChange(type === 'number' ? (event.target.value === '' ? null : Number(event.target.value)) : event.target.value)}
      />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function Section({ icon, title, children }) {
  return (
    <section>
      <h4 style={{ fontSize: 14, marginBottom: 8 }}>{icon} {title}</h4>
      <div className="grid-2" style={{ gap: 12 }}>{children}</div>
    </section>
  );
}

export default function ProfileEditor({ profile = {}, onChange }) {
  const update = (patch) => onChange({ ...profile, ...patch });
  const updateAddress = (patch) => update({ address: { ...(profile.address || {}), ...patch } });
  const updateSalary = (patch) => update({ salary: { ...(profile.salary || {}), ...patch } });
  const updatePreferences = (patch) => update({ preferences: { ...(profile.preferences || {}), ...patch } });
  const csv = (value) => list(value).join(', ');
  const fromCsv = (value) => String(value).split(',').map((item) => item.trim()).filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Section icon={<Sliders size={14} />} title="Professional summary">
        <Field label="Headline" value={text(profile.headline)} onChange={(value) => update({ headline: value })} hint="One line that describes the work you want." />
        <Field label="Years of experience" type="number" value={profile.yearsExperience ?? ''} onChange={(value) => update({ yearsExperience: value })} />
        <div style={{ gridColumn: 'span 2' }}>
          <label>Summary</label>
          <textarea value={text(profile.summary)} onChange={(event) => update({ summary: event.target.value })} style={{ minHeight: 90 }} />
        </div>
        <Field label="Highest qualification" value={text(profile.highestQualification)} onChange={(value) => update({ highestQualification: value })} />
        <Field label="GitHub URL" value={text(profile.githubUrl)} onChange={(value) => update({ githubUrl: value })} placeholder="github.com/you" />
      </Section>

      <Section icon={<MapPin size={14} />} title="Address">
        <Field label="Street address" value={text(profile.address?.line1)} onChange={(value) => updateAddress({ line1: value })} />
        <Field label="Suburb" value={text(profile.address?.suburb)} onChange={(value) => updateAddress({ suburb: value })} />
        <Field label="City" value={text(profile.address?.city)} onChange={(value) => updateAddress({ city: value })} />
        <Field label="Province" value={text(profile.address?.province)} onChange={(value) => updateAddress({ province: value })} />
        <Field label="Postal code" value={text(profile.address?.postalCode)} onChange={(value) => updateAddress({ postalCode: value })} />
      </Section>

      <Section icon={<Wallet size={14} />} title="Salary expectation">
        <Field label="Current amount (ZAR)" type="number" value={profile.salary?.currentAmount ?? ''} onChange={(value) => updateSalary({ currentAmount: value })} />
        <div>
          <label>Current period</label>
          <select value={profile.salary?.currentPeriod || 'month'} onChange={(event) => updateSalary({ currentPeriod: event.target.value })}>
            <option value="month">Per month</option>
            <option value="year">Per year</option>
          </select>
        </div>
        <Field label="Expected amount (ZAR)" type="number" value={profile.salary?.expectedAmount ?? ''} onChange={(value) => updateSalary({ expectedAmount: value })} />
        <div>
          <label>Expected period</label>
          <select value={profile.salary?.expectedPeriod || 'month'} onChange={(event) => updateSalary({ expectedPeriod: event.target.value })}>
            <option value="month">Per month</option>
            <option value="year">Per year</option>
          </select>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={profile.salary?.negotiable === true} onChange={(event) => updateSalary({ negotiable: event.target.checked })} />
          Negotiable
        </label>
      </Section>

      <Section icon={<Languages size={14} />} title="Skills, languages and preferences">
        <Field label="Skills (comma separated)" value={csv(profile.skills)} onChange={(value) => update({ skills: fromCsv(value) })} />
        <Field label="Languages (comma separated)" value={csv(profile.languages)} onChange={(value) => update({ languages: fromCsv(value) })} />
        <Field label="Preferred roles (comma separated)" value={csv(profile.preferences?.roles)} onChange={(value) => updatePreferences({ roles: fromCsv(value) })} />
        <Field label="Preferred sectors (comma separated)" value={csv(profile.preferences?.sectors)} onChange={(value) => updatePreferences({ sectors: fromCsv(value) })} />
        <Field label="Preferred locations (comma separated)" value={csv(profile.preferences?.locations)} onChange={(value) => updatePreferences({ locations: fromCsv(value) })} />
        <div>
          <label>Remote preference</label>
          <select value={profile.preferences?.remote || ''} onChange={(event) => updatePreferences({ remote: event.target.value })}>
            <option value="">No preference</option>
            <option value="yes">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="no">On site</option>
          </select>
        </div>
      </Section>

      <Section icon={<Briefcase size={14} />} title="Work history">
        <div style={{ gridColumn: 'span 2' }}>
          <label>One role per line: Company | Title | Start | End | Location | Bullet; Bullet</label>
          <textarea
            value={list(profile.workHistory).map((role) => [role.company, role.title, role.start, role.end, role.location, list(role.bullets).join('; ')].join(' | ')).join('\n')}
            onChange={(event) => update({ workHistory: event.target.value.split('\n').filter((line) => line.trim()).map((line) => {
              const [company = '', title = '', start = '', end = '', location = '', bullets = ''] = line.split('|').map((part) => part.trim());
              return { company, title, start, end, current: !end, location, bullets: bullets ? bullets.split(';').map((item) => item.trim()).filter(Boolean) : [] };
            }) })}
            style={{ minHeight: 110, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
          />
        </div>
      </Section>

      <Section icon={<GraduationCap size={14} />} title="Education and certifications">
        <div style={{ gridColumn: 'span 2' }}>
          <label>One qualification per line: Institution | Qualification | Field | Year | Result</label>
          <textarea
            value={list(profile.education).map((item) => [item.institution, item.qualification, item.field, item.year, item.result].join(' | ')).join('\n')}
            onChange={(event) => update({ education: event.target.value.split('\n').filter((line) => line.trim()).map((line) => {
              const [institution = '', qualification = '', field = '', year = '', result = ''] = line.split('|').map((part) => part.trim());
              return { institution, qualification, field, year, result };
            }) })}
            style={{ minHeight: 90, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
          />
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <label>One certification per line: Name | Issuer | Year</label>
          <textarea
            value={list(profile.certifications).map((item) => [item.name, item.issuer, item.year].join(' | ')).join('\n')}
            onChange={(event) => update({ certifications: event.target.value.split('\n').filter((line) => line.trim()).map((line) => {
              const [name = '', issuer = '', year = ''] = line.split('|').map((part) => part.trim());
              return { name, issuer, year };
            }) })}
            style={{ minHeight: 70, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
          />
        </div>
      </Section>
    </div>
  );
}
