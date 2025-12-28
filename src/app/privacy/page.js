'use client';

import { ArrowLeft, Mail, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';
import APP_CONFIG from '@/config/app';
import styles from './privacy.module.css';

export default function PrivacyPolicy() {
    const router = useRouter();
    const { legal, name, storage } = APP_CONFIG;

    return (
        <div className={styles.privacyContainer}>
            {/* Header */}
            <header className={styles.header}>
                <div className={styles.headerLeft}>
                    <button
                        className={styles.backButton}
                        onClick={() => router.back()}
                        aria-label="Go back"
                    >
                        <ArrowLeft size={24} />
                    </button>
                    <h1 className={styles.headerTitle}>Privacy Policy</h1>
                </div>
            </header>

            {/* Content */}
            <main className={styles.content}>
                <div className={styles.lastUpdated}>
                    <Shield size={14} />
                    Last updated: {legal.lastUpdated}
                </div>

                <div className={styles.intro}>
                    <p>
                        <strong>{name}</strong> is a personal portfolio tracking application.
                        Your privacy is our priority.
                    </p>
                    <p>
                        {name} stores <strong>all your data locally on your device</strong>.
                        We do not collect, store, or have access to any of your personal or financial data.
                    </p>
                </div>

                {/* Section 1 - Data Controller */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>1</span>
                        <h2 className={styles.sectionTitle}>Data Controller</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            <strong>Responsible:</strong> {legal.dataController.name}
                        </p>
                        <p>
                            <strong>Service:</strong> {legal.service}
                        </p>
                        <div className={styles.contactCard}>
                            <div className={styles.contactIcon}>
                                <Mail size={22} color="#3b82f6" />
                            </div>
                            <div className={styles.contactInfo}>
                                <strong>Contact</strong>
                                <a href={`mailto:${legal.dataController.email}`}>
                                    {legal.dataController.email}
                                </a>
                            </div>
                        </div>
                        <p style={{ marginTop: '0.75rem' }}>
                            For any questions about this privacy policy, please contact us at the email above.
                        </p>
                    </div>
                </section>

                {/* Section 2 - Data We Collect */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>2</span>
                        <h2 className={styles.sectionTitle}>Data We Collect</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            <strong>We do not collect any data.</strong> All information you enter into {name} is
                            stored exclusively on your device using {storage.type}.
                        </p>

                        <div className={styles.subSection}>
                            <h3 className={styles.subSectionTitle}>Data Stored Locally on Your Device</h3>
                            <ul className={styles.dataList}>
                                <li>Portfolio names</li>
                                <li>Asset transactions (symbol, amount, price, date)</li>
                                <li>Transaction notes</li>
                                <li>Currency preferences</li>
                                <li>Deposits and withdrawals</li>
                            </ul>
                        </div>

                        <div className={styles.subSection}>
                            <h3 className={styles.subSectionTitle}>What We DON&apos;T Collect</h3>
                            <ul className={styles.noDataList}>
                                <li>No data is sent to our servers</li>
                                <li>No personal identification documents</li>
                                <li>No email addresses or phone numbers</li>
                                <li>No location data</li>
                                <li>No payment or banking information</li>
                                <li>No analytics or tracking data</li>
                            </ul>
                        </div>
                    </div>
                </section>

                {/* Section 3 - How We Use Your Data */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>3</span>
                        <h2 className={styles.sectionTitle}>How Your Data is Used</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            Your data never leaves your device. It is used solely within the app to:
                        </p>
                        <ul className={styles.dataList}>
                            <li>Display your portfolio holdings and performance</li>
                            <li>Calculate profits, losses, and balances</li>
                            <li>Generate performance charts</li>
                            <li>Enable CSV import/export functionality</li>
                        </ul>
                    </div>
                </section>

                {/* Section 4 - Data Storage */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>4</span>
                        <h2 className={styles.sectionTitle}>Data Storage</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            All data is stored locally on your device using {storage.type}.
                            We have <strong>zero access</strong> to your data — it never
                            leaves your device unless you choose to export it.
                        </p>
                        <p>
                            <strong>Data retention:</strong> Your data remains on your device until you
                            delete it. Uninstalling the app or clearing browser/app data will permanently
                            remove all stored information.
                        </p>
                    </div>
                </section>

                {/* Section 5 - Third-Party Services */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>5</span>
                        <h2 className={styles.sectionTitle}>Third-Party Services</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            {name} does not share any data with third parties. We do not use
                            analytics services, advertising networks, or any third-party tracking.
                        </p>
                    </div>
                </section>

                {/* Section 6 - Your Rights */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>6</span>
                        <h2 className={styles.sectionTitle}>Your Rights</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            Since all data is stored locally, you have complete control:
                        </p>
                        <ul className={styles.dataList}>
                            <li>
                                <strong>Access:</strong> View all your data within the app at any time
                            </li>
                            <li>
                                <strong>Export:</strong> Export your complete portfolio to CSV via Settings
                            </li>
                            <li>
                                <strong>Deletion:</strong> Delete any portfolio, transaction, or all data
                                through the app
                            </li>
                            <li>
                                <strong>Privacy Mode:</strong> Hide sensitive balance information from view
                            </li>
                        </ul>
                    </div>
                </section>

                {/* Section 7 - Data Deletion */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>7</span>
                        <h2 className={styles.sectionTitle}>Data Deletion</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>You have full control over your data:</p>
                        <ul className={styles.dataList}>
                            <li>Delete individual transactions at any time</li>
                            <li>Remove entire portfolios</li>
                            <li>Uninstall the app to remove all data</li>
                        </ul>
                        <div className={styles.highlight}>
                            <p>
                                <strong>Important:</strong> Deleting portfolios is irreversible. All transactions
                                and historical data will be permanently deleted. We recommend exporting
                                your data to CSV before deletion.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Section 8 - Local Storage */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>8</span>
                        <h2 className={styles.sectionTitle}>Cookies and Local Storage</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>We use {storage.type} and local storage to:</p>
                        <ul className={styles.dataList}>
                            <li>Store your portfolio and transaction data</li>
                            <li>Remember your selected portfolio</li>
                            <li>Save your currency and display preferences</li>
                            <li>Cache data for performance</li>
                        </ul>
                        <p>
                            <strong>No tracking cookies are used.</strong> We do not use analytics,
                            advertising, or any third-party cookies.
                        </p>
                    </div>
                </section>

                {/* Section 9 - Children's Privacy */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>9</span>
                        <h2 className={styles.sectionTitle}>Children&apos;s Privacy</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            {name} is not intended for children under 13. We do not knowingly collect
                            any data from children.
                        </p>
                    </div>
                </section>

                {/* Section 10 - Changes */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>10</span>
                        <h2 className={styles.sectionTitle}>Changes to This Policy</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            We may update this privacy policy from time to time. The latest version
                            will always be available at this URL.
                        </p>
                    </div>
                </section>

                {/* Section 11 - Contact */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>11</span>
                        <h2 className={styles.sectionTitle}>Contact</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            For questions about this privacy policy, please contact us:
                        </p>
                        <div className={styles.contactCard}>
                            <div className={styles.contactIcon}>
                                <Mail size={22} color="#3b82f6" />
                            </div>
                            <div className={styles.contactInfo}>
                                <strong>{legal.dataController.name}</strong>
                                <a href={`mailto:${legal.dataController.email}`}>
                                    {legal.dataController.email}
                                </a>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
}
