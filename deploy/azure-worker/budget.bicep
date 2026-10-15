targetScope = 'resourceGroup'

@description('Monthly cost budget for the OSA Worker resource group.')
@minValue(1)
param amount int = 40

@description('Budget start date. Defaults to the first day of the current UTC month.')
param startDate string = utcNow('yyyy-MM-01')

@description('Budget end date.')
param endDate string = dateTimeAdd(startDate, 'P2Y')

resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'rg-osa-worker-monthly'
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
      endDate: endDate
    }
    notifications: {
      Actual50: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 50
        thresholdType: 'Actual'
        contactEmails: []
        contactRoles: [
          'Owner'
        ]
      }
      Actual75: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 75
        thresholdType: 'Actual'
        contactEmails: []
        contactRoles: [
          'Owner'
        ]
      }
      Actual90: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 90
        thresholdType: 'Actual'
        contactEmails: []
        contactRoles: [
          'Owner'
        ]
      }
      Forecast100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: []
        contactRoles: [
          'Owner'
        ]
      }
    }
  }
}
