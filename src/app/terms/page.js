'use client';

import { Suspense, useEffect } from 'react';
import { ArrowLeft, Mail, FileText } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import APP_CONFIG from '@/config/app';
import styles from './terms.module.css';

function TermsAndConditionsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { legal, name } = APP_CONFIG;
    const fromSettings = searchParams.get('from') === 'settings';

    const handleBack = () => {
        if (fromSettings) {
            // Use replace to avoid adding extra history entry
            router.replace('/?settings=true');
        } else {
            router.back();
        }
    };

    // Handle Android back button/gesture
    useEffect(() => {
        let backButtonListener = null;

        const setupBackButton = async () => {
            try {
                const { App } = await import('@capacitor/app');
                backButtonListener = await App.addListener('backButton', () => {
                    handleBack();
                });
            } catch (e) {
                // Capacitor not available (web browser)
            }
        };

        setupBackButton();

        return () => {
            if (backButtonListener) {
                backButtonListener.remove();
            }
        };
    }, [fromSettings]);

    return (
        <div className={styles.termsContainer}>
            {/* Header */}
            <header className={styles.header}>
                <div className={styles.headerLeft}>
                    <button
                        className={styles.backButton}
                        onClick={handleBack}
                        aria-label="Go back"
                    >
                        <ArrowLeft size={24} />
                    </button>
                    <h1 className={styles.headerTitle}>Terms & Conditions</h1>
                </div>
            </header>

            {/* Content */}
            <main className={styles.content}>
                <div className={styles.lastUpdated}>
                    <FileText size={14} />
                    Last updated: {legal.lastUpdated}
                </div>

                <div className={styles.intro}>
                    <p>
                        By accessing and using <strong>{name}</strong> (&quot;the App&quot;), you accept and agree
                        to be bound by these Terms and Conditions. If you do not agree with any part of
                        these terms, you must not use the App.
                    </p>
                    <p>
                        <strong>Important:</strong> {name} is provided as a free, personal project for
                        portfolio tracking. By using this App, you acknowledge that it is provided
                        &quot;as-is&quot; without warranties of any kind.
                    </p>
                </div>

                {/* Section 1 - Acceptance of Terms */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>1</span>
                        <h2 className={styles.sectionTitle}>Acceptance of Terms</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            By downloading, installing, or using {name}, you agree to these Terms and Conditions.
                            These terms constitute a legally binding agreement between you and the service provider.
                        </p>
                        <p>
                            If you do not agree to these terms, please do not use the App.
                        </p>
                    </div>
                </section>

                {/* Section 2 - Service Provider */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>2</span>
                        <h2 className={styles.sectionTitle}>Service Provider</h2>
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
                    </div>
                </section>

                {/* Section 3 - Description of Service */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>3</span>
                        <h2 className={styles.sectionTitle}>Description of Service</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            {name} is a free application that allows users to:
                        </p>
                        <ul className={styles.dataList}>
                            <li>Create and manage investment portfolios</li>
                            <li>Track stocks, cryptocurrencies, and other assets</li>
                            <li>Record buy/sell transactions and deposits/withdrawals</li>
                            <li>View portfolio performance and profit/loss calculations</li>
                            <li>Import and export data via CSV files</li>
                            <li>View asset prices and historical charts</li>
                        </ul>
                        <div className={styles.highlight}>
                            <p>
                                <strong>Important:</strong> All data is stored locally on your device.
                                We do not have access to your portfolio data.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Section 4 - User Responsibilities */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>4</span>
                        <h2 className={styles.sectionTitle}>User Responsibilities</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <div className={styles.subSection}>
                            <h3 className={styles.subSectionTitle}>4.1 No Registration Required</h3>
                            <p>
                                {name} does not require user registration. All data is stored locally
                                on your device. You are solely responsible for backing up your data.
                            </p>
                        </div>

                        <div className={styles.subSection}>
                            <h3 className={styles.subSectionTitle}>4.2 Your Responsibilities</h3>
                            <p>You are responsible for:</p>
                            <ul className={styles.dataList}>
                                <li>The accuracy of transaction information you enter</li>
                                <li>Backing up your portfolio data using the export feature</li>
                                <li>Protecting your device and data from unauthorized access</li>
                                <li>Verifying all calculations before making financial decisions</li>
                                <li>Not using the App for illegal purposes</li>
                            </ul>
                        </div>

                        <div className={styles.subSection}>
                            <h3 className={styles.subSectionTitle}>4.3 Data Security</h3>
                            <p>
                                Since all data is stored locally on your device, you acknowledge that:
                            </p>
                            <ul className={styles.dataList}>
                                <li>You are responsible for securing your device</li>
                                <li>Clearing app data or uninstalling will delete all your data</li>
                                <li>You should regularly export your data as a backup</li>
                            </ul>
                        </div>
                    </div>
                </section>

                {/* Section 5 - Acceptable Use */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>5</span>
                        <h2 className={styles.sectionTitle}>Acceptable Use</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <div className={styles.subSection}>
                            <h3 className={styles.subSectionTitle}>5.1 Permitted Use</h3>
                            <p>You may use {name} for:</p>
                            <ul className={styles.dataList}>
                                <li>Tracking personal investment portfolios</li>
                                <li>Recording and analyzing your transactions</li>
                                <li>Viewing asset prices and performance</li>
                                <li>Personal, non-commercial purposes</li>
                            </ul>
                        </div>

                        <div className={styles.subSection}>
                            <h3 className={styles.subSectionTitle}>5.2 Prohibited Use</h3>
                            <p>You agree NOT to:</p>
                            <ul className={styles.warningList}>
                                <li>Use the App for illegal activities or fraud</li>
                                <li>Reverse engineer, decompile, or extract source code</li>
                                <li>Use automated systems (bots) to access the App</li>
                                <li>Interfere with the proper functioning of the App</li>
                                <li>Use the App for commercial purposes without permission</li>
                            </ul>
                        </div>
                    </div>
                </section>

                {/* Section 6 - Intellectual Property */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>6</span>
                        <h2 className={styles.sectionTitle}>Intellectual Property</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            All intellectual property rights in {name}, including but not limited to:
                        </p>
                        <ul className={styles.dataList}>
                            <li>Software code and architecture</li>
                            <li>User interface design</li>
                            <li>Logos, trademarks, and branding</li>
                            <li>Documentation and content</li>
                        </ul>
                        <p>
                            Are owned by {legal.dataController.name} and are protected by copyright
                            and intellectual property laws.
                        </p>
                        <p>
                            <strong>License granted:</strong> You are granted a limited, non-exclusive,
                            non-transferable license to use the App for personal purposes in accordance
                            with these Terms.
                        </p>
                    </div>
                </section>

                {/* Section 7 - Privacy */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>7</span>
                        <h2 className={styles.sectionTitle}>Privacy and Data Protection</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            Your privacy is important to us. Please review our{' '}
                            <a href="/privacy" style={{ color: '#3b82f6' }}>Privacy Policy</a>{' '}
                            which explains how your data is handled.
                        </p>
                        <p><strong>Key Points:</strong></p>
                        <ul className={styles.dataList}>
                            <li>All data is stored locally on your device</li>
                            <li>We do not collect or have access to your portfolio data</li>
                            <li>No personal information is transmitted to our servers</li>
                            <li>You have full control to delete all your data at any time</li>
                        </ul>
                    </div>
                </section>

                {/* Section 8 - Disclaimers */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>8</span>
                        <h2 className={styles.sectionTitle}>Disclaimers and Limitation of Liability</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <div className={styles.subSection}>
                            <h3 className={styles.subSectionTitle}>8.1 &quot;As-Is&quot; Service</h3>
                            <p>
                                {name} is provided &quot;AS-IS&quot; and &quot;AS AVAILABLE&quot; without warranties
                                of any kind, either express or implied, including but not limited to:
                            </p>
                            <ul className={styles.dataList}>
                                <li>Merchantability or fitness for a particular purpose</li>
                                <li>Accuracy of price data or calculations</li>
                                <li>Uninterrupted or error-free operation</li>
                                <li>Security or absence of bugs</li>
                            </ul>
                        </div>

                        <div className={styles.subSection}>
                            <h3 className={styles.subSectionTitle}>8.2 No Financial Advice</h3>
                            <div className={styles.warningHighlight}>
                                <p>
                                    <strong>Important:</strong> {name} is a tool for tracking portfolios only.
                                    It does NOT provide financial, investment, tax, or legal advice.
                                    You should verify all calculations and consult qualified professionals
                                    before making any financial decisions.
                                </p>
                            </div>
                        </div>

                        <div className={styles.subSection}>
                            <h3 className={styles.subSectionTitle}>8.3 Limitation of Liability</h3>
                            <p>
                                To the maximum extent permitted by law, {legal.dataController.name} shall
                                not be liable for:
                            </p>
                            <ul className={styles.dataList}>
                                <li>Any indirect, incidental, special, or consequential damages</li>
                                <li>Loss of data, profits, or investment opportunities</li>
                                <li>Financial decisions made based on App calculations</li>
                                <li>Incorrect calculations due to user input errors</li>
                                <li>Data loss from device issues or app updates</li>
                                <li>Any damages arising from the use or inability to use the App</li>
                            </ul>
                            <p>
                                <strong>Maximum liability:</strong> If liability cannot be excluded by law,
                                our maximum liability shall not exceed €100.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Section 9 - Service Availability */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>9</span>
                        <h2 className={styles.sectionTitle}>Service Availability</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            Since {name} stores all data locally, the App will function offline.
                            However, features that require internet connectivity (such as viewing
                            current asset prices) may be temporarily unavailable.
                        </p>
                        <p>
                            We may release updates or modifications at any time to improve the App.
                        </p>
                    </div>
                </section>

                {/* Section 10 - Termination */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>10</span>
                        <h2 className={styles.sectionTitle}>Termination</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <div className={styles.subSection}>
                            <h3 className={styles.subSectionTitle}>10.1 By You</h3>
                            <p>
                                You may stop using {name} at any time by uninstalling the App.
                                All locally stored data will be deleted upon uninstallation.
                            </p>
                        </div>

                        <div className={styles.subSection}>
                            <h3 className={styles.subSectionTitle}>10.2 By Us</h3>
                            <p>We reserve the right to:</p>
                            <ul className={styles.dataList}>
                                <li>Discontinue the service at any time with reasonable notice</li>
                                <li>Modify or remove features of the App</li>
                            </ul>
                        </div>
                    </div>
                </section>

                {/* Section 11 - Changes to Terms */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>11</span>
                        <h2 className={styles.sectionTitle}>Changes to Terms</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            We may modify these Terms at any time. Continued use of the App after
                            changes constitutes acceptance of the new Terms. The latest version
                            will always be available at this URL.
                        </p>
                    </div>
                </section>

                {/* Section 12 - Governing Law */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>12</span>
                        <h2 className={styles.sectionTitle}>Governing Law and Jurisdiction</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            These Terms are governed by Spanish law and EU regulations,
                            particularly the GDPR.
                        </p>
                        <p>
                            Any disputes shall be resolved in the courts of Spain, or the
                            user&apos;s jurisdiction if consumer protection laws require it.
                        </p>
                    </div>
                </section>

                {/* Section 13 - Contact */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>13</span>
                        <h2 className={styles.sectionTitle}>Contact</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            For questions, concerns, or to report issues with the App:
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
                        <p style={{ marginTop: '0.75rem' }}>
                            We aim to respond within 15 business days.
                        </p>
                    </div>
                </section>

                {/* Section 14 - Severability */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>14</span>
                        <h2 className={styles.sectionTitle}>Severability</h2>
                    </div>
                    <div className={styles.sectionContent}>
                        <p>
                            If any provision of these Terms is found to be invalid or unenforceable,
                            the remaining provisions shall remain in full force and effect.
                        </p>
                    </div>
                </section>

                {/* Footer Agreement */}
                <div className={styles.footer}>
                    <p>
                        By using {name}, you acknowledge that you have read, understood,
                        and agree to be bound by these Terms and Conditions.
                    </p>
                </div>
            </main>
        </div>
    );
}

export default function TermsAndConditions() {
    return (
        <Suspense fallback={<div className={styles.termsContainer} />}>
            <TermsAndConditionsContent />
        </Suspense>
    );
}
