const mongoose = require('mongoose');
const path = require('path');

// Try different env file locations
const envPaths = [
  path.resolve(__dirname, '../../.env.development'),
  path.resolve(__dirname, '../../.env.local'),
  path.resolve(__dirname, '../../.env')
];

for (const envPath of envPaths) {
  try {
    require('dotenv').config({ path: envPath });
    break;
  } catch (error) {
    // Continue to next path
  }
}

const Department = require('../models/departmentModel');
const KPI = require('../models/kpiModel');
const User = require('../models/userModel');

// Connect to MongoDB
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      throw new Error('No MongoDB URI found in environment variables');
    }
    
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected successfully');
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    return false;
  }
};

// Department ID to KPI type mapping - Direct mapping using department IDs
const getDepartmentKPITypeById = (departmentId) => {
  const id = departmentId.toString();
  
  // Direct mapping using your provided department IDs
  if (id === '6813650b636d908096e421ca') return 'operations'; // Operations
  if (id === '681308546a8619ac127a95d2') return 'hr'; // Human Resource
  if (id === '68136177636d908096e420ce') return 'content'; // Content
  if (id === '68136442636d908096e4213b') return 'central'; // Central
  if (id === '681307806a8619ac127a95b4') return 'tech'; // Tech
  if (id === '68138504636d908096e42aa6') return 'product'; // Product
  if (id === '68136352636d908096e42122') return 'sales'; // Sales
  if (id === '6813654b636d908096e421fa') return 'finance'; // Finance
  if (id === '6822f70900ff462e269d50ee') return 'data'; // Data
  
  // For any other departments not in your list, no KPIs
  return 'generic';
};

// KPI definitions for each functional type
const getKPIDefinitions = (kpiType) => {
  const kpiSets = {
    // HR KPIs (Counselling Department)
    hr: [
      { name: "recruitmentTAT", description: "Recruitment Turnaround Time (TAT)", maxRating: 5 },
      { name: "offerToJoinRatio", description: "Offer-to-Join Ratio", maxRating: 5 },
      { name: "offerDropoutNoShowRatio", description: "Offer Dropout/No-Show Ratio", maxRating: 5 },
      { name: "qualityOfScreeningSourcing", description: "Quality of Screening/Sourcing", maxRating: 5 },
      { name: "replacementHiringEfficiency", description: "Replacement Hiring Efficiency", maxRating: 5 },
      { name: "retentionOfNewHires", description: "Retention of New Hires (90/180 Days)", maxRating: 5 }
    ],
    // Central KPIs (Admin & IT Department)
    central: [
      { name: "aptitude", description: "Aptitude: Ability to grasp concepts, solve problems, and adapt quickly.", maxRating: 5 },
      { name: "newInitiatives", description: "New Initiatives: Proactively driving new ideas, improvements, or projects.", maxRating: 5 },
      { name: "ownership", description: "Ownership: Taking full responsibility for tasks and their outcomes.", maxRating: 5 },
      { name: "deadlineManagement", description: "Deadline Management: Consistently meeting timelines through effective planning.", maxRating: 5 },
      { name: "responseTime", description: "Response Time: Promptly responding to messages and addressing blockers.", maxRating: 5 },
      { name: "technicalSkills", description: "Technical Skills: Proficiency in relevant technical tools, software, and methodologies.", maxRating: 5 }
    ],
    // Product KPIs (Product Department)
    product: [
      { name: "requirementClarity", description: "Requirement Clarity – % of stories/features accepted without rework or clarification.", maxRating: 5 },
      { name: "teamCollaboration", description: "Team Collaboration – Active participation in sprint planning, reviews, and cross-functional syncs.", maxRating: 5 },
      { name: "ownership", description: "Ownership – Accountability for end-to-end delivery of features within agreed timelines.", maxRating: 5 },
      { name: "researchDiscovery", description: "Research & Discovery – Quality and frequency of market/competitor/tech research feeding into roadmap.", maxRating: 5 },
      { name: "discipline", description: "Discipline – Adherence to sprint rituals, documentation standards, and delivery processes.", maxRating: 5 },
      { name: "userTestingFeedbackIntegration", description: "User Testing & Feedback Integration – % of features validated with users before/after release and acted upon.", maxRating: 5 }
    ],
    // Tech KPIs (Data Department)
    tech: [
      { name: "codeQuality", description: "Code Quality – Measured through review feedback, defect density, and production bugs in owned modules.", maxRating: 5 },
      { name: "taskStoryCompletionRate", description: "Task / Story Completion Rate – Percentage of assigned tasks or sprint stories delivered within the committed timeline.", maxRating: 5 },
      { name: "ownershipDelivery", description: "Ownership & Delivery – Lead time from code commit to production, including accountability for smooth releases.", maxRating: 5 },
      { name: "collaborationCodeReviews", description: "Collaboration & Code Reviews – Active participation in peer code reviews and providing constructive feedback.", maxRating: 5 },
      { name: "issueResolutionTime", description: "Issue Resolution Time – Average time taken to resolve assigned bugs, incidents, or support tickets.", maxRating: 5 },
      { name: "continuousLearningContribution", description: "Continuous Learning & Contribution – Adoption of new tools/technologies, knowledge sharing, documentation, and mentoring peers.", maxRating: 5 }
    ],
    // Sales KPIs (Business Department)
    sales: [
      { name: "clientInteractionCommunication", description: "Client Interaction & Communication", maxRating: 5 },
      { name: "dealPipelineConversion", description: "Deal Pipeline & Conversion", maxRating: 5 },
      { name: "processComplianceAdherence", description: "Process Compliance and Adherence", maxRating: 5 },
      { name: "businessImpactContribution", description: "Business Impact and Contribution", maxRating: 5 },
      { name: "ownershipTeamCollaboration", description: "Ownership & Team Collaboration", maxRating: 5 },
      { name: "competitionAwarenessIndustryInsights", description: "Competition Awareness and Industry Insights", maxRating: 5 }
    ],
    // Content KPIs (SEO Department)  
    content: [
      { name: "contentQuality", description: "Content Quality – Accuracy, grammar, clarity, and adherence to content guidelines.", maxRating: 5 },
      { name: "productivityOutput", description: "Productivity / Output – Number of content pieces completed on time vs target.", maxRating: 5 },
      { name: "creativityOriginality", description: "Creativity & Originality – Ability to generate fresh ideas and unique content.", maxRating: 5 },
      { name: "consistencyReliability", description: "Consistency & Reliability – Regularity in meeting deadlines and following standards.", maxRating: 5 },
      { name: "responsivenessToFeedback", description: "Responsiveness to Feedback – Speed and effectiveness in implementing editorial suggestions.", maxRating: 5 },
      { name: "discipline", description: "Discipline – Adherence to content standards, SEO guidelines, and publishing schedules.", maxRating: 5 }
    ],
    // Operations KPIs
    operations: [
      { name: "deliveryVsCommitment", description: "Delivery vs. Commitment", maxRating: 5 },
      { name: "turnaroundTimeTATCompliance", description: "Turnaround Time (TAT) Compliance", maxRating: 5 },
      { name: "qualityAccuracy", description: "Quality & Accuracy", maxRating: 5 },
      { name: "ownershipAccountability", description: "Ownership & Accountability", maxRating: 5 },
      { name: "innovationContinuousImprovement", description: "Innovation & Continuous Improvement", maxRating: 5 },
      { name: "collaborationIssueResolution", description: "Collaboration & Issue Resolution", maxRating: 5 }
    ],
    // Finance KPIs
    finance: [
      { name: "discipline", description: "Discipline", maxRating: 5 },
      { name: "skillDevelopment", description: "Skill Development", maxRating: 5 },
      { name: "timelinessAccuracyReports", description: "Timeliness and accuracy of reports.", maxRating: 5 },
      { name: "complianceAccountingTax", description: "Compliance with accounting and tax regulations.", maxRating: 5 },
      { name: "errorRateFinancialStatements", description: "Error rate in financial statements.", maxRating: 5 },
      { name: "contributionProcessImprovements", description: "Contribution to process improvements.", maxRating: 5 }
    ],
    // Data KPIs (separate from Tech KPIs)
    data: [
      { name: "timelyDataUpdates", description: "Timely Data Updates", maxRating: 5 },
      { name: "dataAccuracyQuality", description: "Data Accuracy & Quality", maxRating: 5 },
      { name: "technicalSkillsCompetence", description: "Technical Skills & Competence", maxRating: 5 },
      { name: "deadlineTimeManagement", description: "Deadline & Time Management", maxRating: 5 },
      { name: "problemSolvingInitiative", description: "Problem-Solving & Initiative", maxRating: 5 },
      { name: "teamCollaboration", description: "Team collaboration", maxRating: 5 }
    ]
  };

  return kpiSets[kpiType] || [];
};

// Main setup function
const setupKPIs = async () => {
  try {
    console.log('🚀 Setting up KPIs dynamically...\n');
    
    const connected = await connectDB();
    if (!connected) {
      return false;
    }

    // Find admin user
    const adminUser = await User.findOne({ role: { $in: ['admin', 'subadmin'] } });
    if (!adminUser) {
      console.log('❌ No admin user found');
      return false;
    }
    console.log(`✅ Admin user: ${adminUser.firstName} ${adminUser.lastName}\n`);

    // Get all departments dynamically
    const departments = await Department.find({ isDeleted: false });
    console.log(`📂 Found ${departments.length} departments:`);
    
    let created = 0;
    let skipped = 0;

    // Process each department
    for (const department of departments) {
      console.log(`\n🏢 Processing: ${department.name} (${department._id})`);
      
      // Check if KPIs already exist
      const existingKPI = await KPI.findOne({
        departmentId: department._id,
        isDeleted: false
      });

      if (existingKPI) {
        console.log(`   ⏭️  Already has KPIs (${existingKPI.kpis.length} items)`);
        skipped++;
        continue;
      }

      // Determine KPI type using department ID
      const kpiType = getDepartmentKPITypeById(department._id);
      console.log(`   📊 KPI Type: ${kpiType}`);
      
      if (kpiType === 'generic') {
        console.log(`   📝 Will use generic KPIs (no record needed)`);
        continue;
      }

      // Get KPI definitions
      const kpiDefinitions = getKPIDefinitions(kpiType);
      console.log(`   📋 Creating ${kpiDefinitions.length} KPIs`);

      // Create KPI record
      const newKPI = new KPI({
        departmentId: department._id, // Only store ObjectId, no name
        kpis: kpiDefinitions,
        createdBy: adminUser._id,
        updatedBy: adminUser._id
      });

      await newKPI.save();
      created++;
      
      console.log(`   ✅ Created ${kpiType} KPIs`);
      kpiDefinitions.forEach((kpi, index) => {
        console.log(`      ${index + 1}. ${kpi.name}`);
      });
    }

    console.log(`\n🎉 KPI Setup Complete!`);
    console.log(`📊 Summary:`);
    console.log(`   - Total departments: ${departments.length}`);
    console.log(`   - KPI records created: ${created}`);
    console.log(`   - Departments skipped: ${skipped}`);
    console.log(`   - Departments using generic KPIs: ${departments.length - created - skipped}`);

    // Verify setup
    const allKPIs = await KPI.find({ isDeleted: false }).populate('departmentId', 'name');
    console.log(`\n🔍 Verification - KPI Records in Database:`);
    allKPIs.forEach(kpi => {
      console.log(`   ✅ ${kpi.departmentId.name}: ${kpi.kpis.length} KPIs`);
    });

    return true;

  } catch (error) {
    console.error('❌ Error setting up KPIs:', error);
    return false;
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('\n🔌 Database connection closed');
    }
  }
};

// Run the setup
if (require.main === module) {
  setupKPIs().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { setupKPIs, getDepartmentKPITypeById, getKPIDefinitions };
