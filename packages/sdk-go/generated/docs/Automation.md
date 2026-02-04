# Automation

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Automation UUID | 
**Name** | **string** | Name | 
**Description** | **NullableString** | Description | 
**TriggerEventType** | **string** | Trigger event type | 
**TriggerConditions** | [**[]ListAutomations200ResponseItemsInnerTriggerConditionsInner**](ListAutomations200ResponseItemsInnerTriggerConditionsInner.md) | Conditions | 
**ConditionLogic** | **NullableString** | Condition logic | 
**Actions** | [**[]ListAutomations200ResponseItemsInnerActionsInner**](ListAutomations200ResponseItemsInnerActionsInner.md) | Actions | 
**Debounce** | [**NullableListAutomations200ResponseItemsInnerDebounce**](ListAutomations200ResponseItemsInnerDebounce.md) |  | 
**Enabled** | **bool** | Whether enabled | 
**Priority** | **int32** | Priority | 
**CreatedAt** | **time.Time** | Creation timestamp | 
**UpdatedAt** | **time.Time** | Last update timestamp | 

## Methods

### NewAutomation

`func NewAutomation(id string, name string, description NullableString, triggerEventType string, triggerConditions []ListAutomations200ResponseItemsInnerTriggerConditionsInner, conditionLogic NullableString, actions []ListAutomations200ResponseItemsInnerActionsInner, debounce NullableListAutomations200ResponseItemsInnerDebounce, enabled bool, priority int32, createdAt time.Time, updatedAt time.Time, ) *Automation`

NewAutomation instantiates a new Automation object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewAutomationWithDefaults

`func NewAutomationWithDefaults() *Automation`

NewAutomationWithDefaults instantiates a new Automation object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *Automation) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *Automation) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *Automation) SetId(v string)`

SetId sets Id field to given value.


### GetName

`func (o *Automation) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *Automation) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *Automation) SetName(v string)`

SetName sets Name field to given value.


### GetDescription

`func (o *Automation) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *Automation) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *Automation) SetDescription(v string)`

SetDescription sets Description field to given value.


### SetDescriptionNil

`func (o *Automation) SetDescriptionNil(b bool)`

 SetDescriptionNil sets the value for Description to be an explicit nil

### UnsetDescription
`func (o *Automation) UnsetDescription()`

UnsetDescription ensures that no value is present for Description, not even an explicit nil
### GetTriggerEventType

`func (o *Automation) GetTriggerEventType() string`

GetTriggerEventType returns the TriggerEventType field if non-nil, zero value otherwise.

### GetTriggerEventTypeOk

`func (o *Automation) GetTriggerEventTypeOk() (*string, bool)`

GetTriggerEventTypeOk returns a tuple with the TriggerEventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTriggerEventType

`func (o *Automation) SetTriggerEventType(v string)`

SetTriggerEventType sets TriggerEventType field to given value.


### GetTriggerConditions

`func (o *Automation) GetTriggerConditions() []ListAutomations200ResponseItemsInnerTriggerConditionsInner`

GetTriggerConditions returns the TriggerConditions field if non-nil, zero value otherwise.

### GetTriggerConditionsOk

`func (o *Automation) GetTriggerConditionsOk() (*[]ListAutomations200ResponseItemsInnerTriggerConditionsInner, bool)`

GetTriggerConditionsOk returns a tuple with the TriggerConditions field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTriggerConditions

`func (o *Automation) SetTriggerConditions(v []ListAutomations200ResponseItemsInnerTriggerConditionsInner)`

SetTriggerConditions sets TriggerConditions field to given value.


### SetTriggerConditionsNil

`func (o *Automation) SetTriggerConditionsNil(b bool)`

 SetTriggerConditionsNil sets the value for TriggerConditions to be an explicit nil

### UnsetTriggerConditions
`func (o *Automation) UnsetTriggerConditions()`

UnsetTriggerConditions ensures that no value is present for TriggerConditions, not even an explicit nil
### GetConditionLogic

`func (o *Automation) GetConditionLogic() string`

GetConditionLogic returns the ConditionLogic field if non-nil, zero value otherwise.

### GetConditionLogicOk

`func (o *Automation) GetConditionLogicOk() (*string, bool)`

GetConditionLogicOk returns a tuple with the ConditionLogic field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetConditionLogic

`func (o *Automation) SetConditionLogic(v string)`

SetConditionLogic sets ConditionLogic field to given value.


### SetConditionLogicNil

`func (o *Automation) SetConditionLogicNil(b bool)`

 SetConditionLogicNil sets the value for ConditionLogic to be an explicit nil

### UnsetConditionLogic
`func (o *Automation) UnsetConditionLogic()`

UnsetConditionLogic ensures that no value is present for ConditionLogic, not even an explicit nil
### GetActions

`func (o *Automation) GetActions() []ListAutomations200ResponseItemsInnerActionsInner`

GetActions returns the Actions field if non-nil, zero value otherwise.

### GetActionsOk

`func (o *Automation) GetActionsOk() (*[]ListAutomations200ResponseItemsInnerActionsInner, bool)`

GetActionsOk returns a tuple with the Actions field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetActions

`func (o *Automation) SetActions(v []ListAutomations200ResponseItemsInnerActionsInner)`

SetActions sets Actions field to given value.


### GetDebounce

`func (o *Automation) GetDebounce() ListAutomations200ResponseItemsInnerDebounce`

GetDebounce returns the Debounce field if non-nil, zero value otherwise.

### GetDebounceOk

`func (o *Automation) GetDebounceOk() (*ListAutomations200ResponseItemsInnerDebounce, bool)`

GetDebounceOk returns a tuple with the Debounce field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDebounce

`func (o *Automation) SetDebounce(v ListAutomations200ResponseItemsInnerDebounce)`

SetDebounce sets Debounce field to given value.


### SetDebounceNil

`func (o *Automation) SetDebounceNil(b bool)`

 SetDebounceNil sets the value for Debounce to be an explicit nil

### UnsetDebounce
`func (o *Automation) UnsetDebounce()`

UnsetDebounce ensures that no value is present for Debounce, not even an explicit nil
### GetEnabled

`func (o *Automation) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *Automation) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *Automation) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.


### GetPriority

`func (o *Automation) GetPriority() int32`

GetPriority returns the Priority field if non-nil, zero value otherwise.

### GetPriorityOk

`func (o *Automation) GetPriorityOk() (*int32, bool)`

GetPriorityOk returns a tuple with the Priority field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPriority

`func (o *Automation) SetPriority(v int32)`

SetPriority sets Priority field to given value.


### GetCreatedAt

`func (o *Automation) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *Automation) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *Automation) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.


### GetUpdatedAt

`func (o *Automation) GetUpdatedAt() time.Time`

GetUpdatedAt returns the UpdatedAt field if non-nil, zero value otherwise.

### GetUpdatedAtOk

`func (o *Automation) GetUpdatedAtOk() (*time.Time, bool)`

GetUpdatedAtOk returns a tuple with the UpdatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUpdatedAt

`func (o *Automation) SetUpdatedAt(v time.Time)`

SetUpdatedAt sets UpdatedAt field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


