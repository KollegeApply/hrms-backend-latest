const KPI = require('../models/kpiModel');
const Department = require('../models/departmentModel');
const EmployeeKpiOverride = require('../models/employeeKpiOverrideModel');
const logger = require('../config/logger');

class KPIService {
  
  // Get KPIs for a specific department by ObjectId
  async getKPIsByDepartmentId(departmentId) {
    try {
      const kpis = await KPI.findOne({
        departmentId: departmentId,
        isActive: true,
        isDeleted: false
      }).populate('departmentId', 'name');
      
      return kpis;
    } catch (error) {
      logger.error('Error fetching KPIs by department ID:', error);
      return null;
    }
  }




  // Get generic KPIs for departments without specific ones
  getGenericKPIs() {
    return {
      departmentName: 'generic',
      kpis: [
        {
          name: 'discipline',
          description: 'Punctuality, adherence to policies, and professional conduct',
          maxRating: 5
        },
        {
          name: 'initiative',
          description: 'Proactiveness in taking on tasks and suggesting improvements',
          maxRating: 5
        },
        {
          name: 'teamwork',
          description: 'Collaboration with team members and cross-functional teams',
          maxRating: 5
        },
        {
          name: 'ownership',
          description: 'Taking responsibility for tasks and their outcomes',
          maxRating: 5
        },
        {
          name: 'skillDevelopment',
          description: 'Continuous learning and skill improvement',
          maxRating: 5
        },
        {
          name: 'communication',
          description: 'Clear and effective communication with team and stakeholders',
          maxRating: 5
        }
      ]
    };
  }

  // Get leadership/management KPIs for employee → TL/STL feedback
  getLeadershipKPIs() {
    return {
      departmentName: 'leadership', // For identification
      kpis: [
        {
          name: 'taskDelegation',
          description: 'Effectively assigns tasks and responsibilities to team members',
          maxRating: 5
        },
        {
          name: 'conflictResolutionMediation',
          description: 'Resolves conflicts and mediates disputes within the team',
          maxRating: 5
        },
        {
          name: 'supportiveness',
          description: 'Provides support and guidance to team members when needed',
          maxRating: 5
        },
        {
          name: 'accessibility',
          description: 'Available and approachable for team members and stakeholders',
          maxRating: 5
        },
        {
          name: 'feedbackRecognition',
          description: 'Provides constructive feedback and recognizes team achievements',
          maxRating: 5
        },
        {
          name: 'knowledgeSharing',
          description: 'Shares knowledge and expertise to help team members grow',
          maxRating: 5
        }
      ]
    };
  }

  async getEmployeeKpiOverride(employeeId) {
    try {
      const override = await EmployeeKpiOverride.findOne({
        employeeId: employeeId,
        isActive: true,
        isDeleted: false
      }).populate('departmentId', 'name');

      return override;
    } catch (error) {
      logger.error('Error fetching employee KPI override:', error);
      return null;
    }
  }

  async createOrUpdateEmployeeKpiOverride(employeeId, departmentId, kpis, userId) {
    try {
      const existingOverride = await EmployeeKpiOverride.findOne({
        employeeId: employeeId,
        isDeleted: false
      });

      if (existingOverride) {
        existingOverride.kpis = kpis;
        existingOverride.departmentId = departmentId || null;
        existingOverride.updatedBy = userId;
        existingOverride.isActive = true;
        await existingOverride.save();
        return existingOverride;
      }

      const newOverride = new EmployeeKpiOverride({
        employeeId,
        departmentId: departmentId || null,
        kpis,
        createdBy: userId,
        updatedBy: userId
      });

      await newOverride.save();
      return newOverride;
    } catch (error) {
      logger.error('Error creating/updating employee KPI override:', error);
      throw error;
    }
  }

  // Create or update KPIs for a department
  async createOrUpdateKPIs(departmentId, kpis, userId) {
    try {
      const existingKPI = await KPI.findOne({
        departmentId: departmentId,
        isDeleted: false
      });

      if (existingKPI) {
        existingKPI.kpis = kpis;
        existingKPI.updatedBy = userId;
        existingKPI.isActive = true;
        await existingKPI.save();
        return existingKPI;
      } else {
        const newKPI = new KPI({
          departmentId: departmentId,
          kpis,
          createdBy: userId,
          updatedBy: userId
        });
        await newKPI.save();
        return newKPI;
      }
    } catch (error) {
      logger.error('Error creating/updating KPIs:', error);
      throw error;
    }
  }

  // Get all KPIs
  async getAllKPIs() {
    try {
      const kpis = await KPI.find({
        isDeleted: false
      }).populate('departmentId', 'name')
        .populate('createdBy updatedBy', 'firstName lastName email');
      
      return kpis;
    } catch (error) {
      logger.error('Error fetching all KPIs:', error);
      throw error;
    }
  }


  // Delete KPIs for a department
  async deleteKPIs(departmentId, userId) {
    try {
      const result = await KPI.findOneAndUpdate(
        {
          departmentId: departmentId,
          isDeleted: false
        },
        {
          isDeleted: true,
          isActive: false,
          updatedBy: userId
        },
        { new: true }
      );

      return result;
    } catch (error) {
      logger.error('Error deleting KPIs:', error);
      throw error;
    }
  }
}

module.exports = new KPIService();
