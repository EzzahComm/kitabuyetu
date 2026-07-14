import {
  Document, Page, Text, View, StyleSheet,
} from '@react-pdf/renderer';

export interface ShareCertificateProps {
  groupName:        string;
  groupCode:        string;
  isGovRegistered:  boolean;
  registrationNo:   string | null;

  memberFirstName:  string;
  memberLastName:   string;
  /** Formatted Membership Number ("BG 10253 4") — the only public payment identifier. */
  membershipNo:     string | null;
  memberNationalId: string | null;

  shareClassName:   string;
  shareClassCode:   string;
  quantity:         number;
  unitPrice:        string;     // already 2dp string
  totalValue:       string;     // quantity × unitPrice, 2dp string
  votingWeight:     string;

  certificateSerial: string;
  issuedAt:          string;    // ISO timestamp
  txnType:           'allocation' | 'purchase' | 'transfer_in';
  txnId:             string;
}

// Currency formatter — Intl works inside @react-pdf since we render to buffer
// from a Node environment that has the ICU bundle.
function fmt(amount: string | number) {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency', currency: 'KES', maximumFractionDigits: 2,
  }).format(Number(amount));
}

const styles = StyleSheet.create({
  page: {
    padding:   48,
    fontSize:  11,
    fontFamily:'Helvetica',
    color:     '#1f2937',
  },
  border: {
    borderWidth:  2,
    borderColor:  '#1e3a8a',
    borderStyle:  'solid',
    padding:      28,
    minHeight:    660,
  },
  innerBorder: {
    borderWidth:  0.5,
    borderColor:  '#1e3a8a',
    borderStyle:  'solid',
    padding:      24,
    flexGrow:     1,
  },
  headerRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'flex-start',
    marginBottom:   18,
  },
  brand: {
    fontSize:     22,
    fontWeight:   700,
    color:        '#1e3a8a',
    letterSpacing: 0.5,
  },
  brandSub: {
    fontSize:  9,
    color:     '#6b7280',
    marginTop: 2,
  },
  serial: {
    fontSize:  10,
    color:     '#374151',
    textAlign: 'right',
  },
  serialValue: {
    fontFamily: 'Courier-Bold',
    fontSize:   12,
  },

  title: {
    fontSize:    26,
    fontWeight:  700,
    textAlign:   'center',
    marginTop:   24,
    marginBottom: 4,
    color:       '#0f172a',
    letterSpacing: 1.5,
  },
  subtitle: {
    fontSize:    11,
    textAlign:   'center',
    color:       '#6b7280',
    marginBottom: 24,
    fontStyle:   'italic',
  },

  body: {
    marginTop:    12,
    paddingHorizontal: 12,
  },
  paragraph: {
    fontSize:   12,
    lineHeight: 1.7,
    marginBottom: 10,
    textAlign:  'justify',
  },
  inline: {
    fontWeight: 700,
    color:      '#0f172a',
  },

  quantityBlock: {
    marginVertical: 24,
    paddingVertical: 16,
    borderTopWidth:  0.5,
    borderBottomWidth: 0.5,
    borderColor:    '#9ca3af',
    alignItems:     'center',
  },
  quantityNumber: {
    fontSize:   38,
    fontWeight: 700,
    color:      '#1e3a8a',
  },
  quantityLabel: {
    fontSize:   10,
    color:      '#6b7280',
    letterSpacing: 2,
    marginTop:  4,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    marginTop:     6,
  },
  detailCol: {
    width:        '50%',
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 8,
    color:    '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  detailValue: {
    fontSize: 11,
    color:    '#0f172a',
  },

  footer: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    marginTop:      30,
    paddingTop:     16,
    borderTopWidth: 0.5,
    borderColor:    '#9ca3af',
  },
  sigBlock: {
    width:         180,
  },
  sigLine: {
    borderBottomWidth: 0.5,
    borderColor:       '#374151',
    height:            32,
  },
  sigLabel: {
    fontSize: 8,
    color:    '#6b7280',
    marginTop: 2,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  fineprint: {
    fontSize:  7,
    color:     '#9ca3af',
    textAlign: 'center',
    marginTop: 18,
  },
});

const TYPE_LABEL: Record<ShareCertificateProps['txnType'], string> = {
  allocation:  'an allocation of',
  purchase:    'the purchase of',
  transfer_in: 'a transfer of',
};

export function ShareCertificate(props: ShareCertificateProps) {
  const fullName = [props.memberFirstName, props.memberLastName].filter(Boolean).join(' ');

  return (
    <Document
      title={`Share Certificate ${props.certificateSerial}`}
      author={props.groupName}
      subject={`${fullName} — ${props.quantity} ${props.shareClassName}`}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.border}>
          <View style={styles.innerBorder}>

            {/* Header */}
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.brand}>{props.groupName.toUpperCase()}</Text>
                <Text style={styles.brandSub}>
                  Group code {props.groupCode}
                  {props.isGovRegistered && props.registrationNo
                    ? ` · Reg. ${props.registrationNo}`
                    : ''}
                </Text>
              </View>
              <View>
                <Text style={styles.serial}>Certificate No.</Text>
                <Text style={[styles.serial, styles.serialValue]}>{props.certificateSerial}</Text>
              </View>
            </View>

            {/* Title */}
            <Text style={styles.title}>SHARE CERTIFICATE</Text>
            <Text style={styles.subtitle}>
              {props.shareClassName} ({props.shareClassCode})
            </Text>

            {/* Body */}
            <View style={styles.body}>
              <Text style={styles.paragraph}>
                This is to certify that{' '}
                <Text style={styles.inline}>{fullName}</Text>
                {props.membershipNo ? <> (member A/C <Text style={styles.inline}>{props.membershipNo}</Text>)</> : null}
                {props.memberNationalId ? <>, holder of national ID <Text style={styles.inline}>{props.memberNationalId}</Text></> : null}
                {' '}is the registered owner of the shares set out below, recorded against{' '}
                {TYPE_LABEL[props.txnType]} <Text style={styles.inline}>{props.quantity}</Text>{' '}
                share(s) of the class <Text style={styles.inline}>{props.shareClassName}</Text>{' '}
                in the capital of <Text style={styles.inline}>{props.groupName}</Text>.
              </Text>

              {/* Quantity block */}
              <View style={styles.quantityBlock}>
                <Text style={styles.quantityNumber}>{props.quantity.toLocaleString()}</Text>
                <Text style={styles.quantityLabel}>SHARES</Text>
              </View>

              {/* Detail grid */}
              <View style={styles.detailGrid}>
                <View style={styles.detailCol}>
                  <Text style={styles.detailLabel}>Per-share value</Text>
                  <Text style={styles.detailValue}>{fmt(props.unitPrice)}</Text>
                </View>
                <View style={styles.detailCol}>
                  <Text style={styles.detailLabel}>Total value</Text>
                  <Text style={styles.detailValue}>{fmt(props.totalValue)}</Text>
                </View>
                <View style={styles.detailCol}>
                  <Text style={styles.detailLabel}>Voting weight</Text>
                  <Text style={styles.detailValue}>{props.votingWeight} per share</Text>
                </View>
                <View style={styles.detailCol}>
                  <Text style={styles.detailLabel}>Issued on</Text>
                  <Text style={styles.detailValue}>
                    {new Date(props.issuedAt).toLocaleDateString('en-KE', {
                      day: '2-digit', month: 'long', year: 'numeric',
                    })}
                  </Text>
                </View>
              </View>
            </View>

            {/* Signatures */}
            <View style={styles.footer}>
              <View style={styles.sigBlock}>
                <View style={styles.sigLine} />
                <Text style={styles.sigLabel}>Chairperson</Text>
              </View>
              <View style={styles.sigBlock}>
                <View style={styles.sigLine} />
                <Text style={styles.sigLabel}>Secretary / Treasurer</Text>
              </View>
            </View>

            <Text style={styles.fineprint}>
              Generated by Kitabu Yetu · Reference TXN {props.txnId}
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
