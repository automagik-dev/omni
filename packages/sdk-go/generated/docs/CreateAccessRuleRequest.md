# CreateAccessRuleRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**InstanceId** | Pointer to **NullableString** | Instance ID (null for global) | [optional] 
**RuleType** | **string** | Rule type | 
**PhonePattern** | Pointer to **string** | Phone pattern with wildcards | [optional] 
**PlatformUserId** | Pointer to **string** | Exact platform user ID | [optional] 
**PersonId** | Pointer to **string** | Person ID | [optional] 
**Priority** | Pointer to **int32** | Priority | [optional] [default to 0]
**Enabled** | Pointer to **bool** | Whether enabled | [optional] [default to true]
**Reason** | Pointer to **string** | Reason | [optional] 
**ExpiresAt** | Pointer to **time.Time** | Expiration | [optional] 
**Action** | Pointer to **string** | Action | [optional] [default to "block"]
**BlockMessage** | Pointer to **string** | Custom block message | [optional] 

## Methods

### NewCreateAccessRuleRequest

`func NewCreateAccessRuleRequest(ruleType string, ) *CreateAccessRuleRequest`

NewCreateAccessRuleRequest instantiates a new CreateAccessRuleRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewCreateAccessRuleRequestWithDefaults

`func NewCreateAccessRuleRequestWithDefaults() *CreateAccessRuleRequest`

NewCreateAccessRuleRequestWithDefaults instantiates a new CreateAccessRuleRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetInstanceId

`func (o *CreateAccessRuleRequest) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *CreateAccessRuleRequest) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *CreateAccessRuleRequest) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.

### HasInstanceId

`func (o *CreateAccessRuleRequest) HasInstanceId() bool`

HasInstanceId returns a boolean if a field has been set.

### SetInstanceIdNil

`func (o *CreateAccessRuleRequest) SetInstanceIdNil(b bool)`

 SetInstanceIdNil sets the value for InstanceId to be an explicit nil

### UnsetInstanceId
`func (o *CreateAccessRuleRequest) UnsetInstanceId()`

UnsetInstanceId ensures that no value is present for InstanceId, not even an explicit nil
### GetRuleType

`func (o *CreateAccessRuleRequest) GetRuleType() string`

GetRuleType returns the RuleType field if non-nil, zero value otherwise.

### GetRuleTypeOk

`func (o *CreateAccessRuleRequest) GetRuleTypeOk() (*string, bool)`

GetRuleTypeOk returns a tuple with the RuleType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRuleType

`func (o *CreateAccessRuleRequest) SetRuleType(v string)`

SetRuleType sets RuleType field to given value.


### GetPhonePattern

`func (o *CreateAccessRuleRequest) GetPhonePattern() string`

GetPhonePattern returns the PhonePattern field if non-nil, zero value otherwise.

### GetPhonePatternOk

`func (o *CreateAccessRuleRequest) GetPhonePatternOk() (*string, bool)`

GetPhonePatternOk returns a tuple with the PhonePattern field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPhonePattern

`func (o *CreateAccessRuleRequest) SetPhonePattern(v string)`

SetPhonePattern sets PhonePattern field to given value.

### HasPhonePattern

`func (o *CreateAccessRuleRequest) HasPhonePattern() bool`

HasPhonePattern returns a boolean if a field has been set.

### GetPlatformUserId

`func (o *CreateAccessRuleRequest) GetPlatformUserId() string`

GetPlatformUserId returns the PlatformUserId field if non-nil, zero value otherwise.

### GetPlatformUserIdOk

`func (o *CreateAccessRuleRequest) GetPlatformUserIdOk() (*string, bool)`

GetPlatformUserIdOk returns a tuple with the PlatformUserId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformUserId

`func (o *CreateAccessRuleRequest) SetPlatformUserId(v string)`

SetPlatformUserId sets PlatformUserId field to given value.

### HasPlatformUserId

`func (o *CreateAccessRuleRequest) HasPlatformUserId() bool`

HasPlatformUserId returns a boolean if a field has been set.

### GetPersonId

`func (o *CreateAccessRuleRequest) GetPersonId() string`

GetPersonId returns the PersonId field if non-nil, zero value otherwise.

### GetPersonIdOk

`func (o *CreateAccessRuleRequest) GetPersonIdOk() (*string, bool)`

GetPersonIdOk returns a tuple with the PersonId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPersonId

`func (o *CreateAccessRuleRequest) SetPersonId(v string)`

SetPersonId sets PersonId field to given value.

### HasPersonId

`func (o *CreateAccessRuleRequest) HasPersonId() bool`

HasPersonId returns a boolean if a field has been set.

### GetPriority

`func (o *CreateAccessRuleRequest) GetPriority() int32`

GetPriority returns the Priority field if non-nil, zero value otherwise.

### GetPriorityOk

`func (o *CreateAccessRuleRequest) GetPriorityOk() (*int32, bool)`

GetPriorityOk returns a tuple with the Priority field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPriority

`func (o *CreateAccessRuleRequest) SetPriority(v int32)`

SetPriority sets Priority field to given value.

### HasPriority

`func (o *CreateAccessRuleRequest) HasPriority() bool`

HasPriority returns a boolean if a field has been set.

### GetEnabled

`func (o *CreateAccessRuleRequest) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *CreateAccessRuleRequest) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *CreateAccessRuleRequest) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.

### HasEnabled

`func (o *CreateAccessRuleRequest) HasEnabled() bool`

HasEnabled returns a boolean if a field has been set.

### GetReason

`func (o *CreateAccessRuleRequest) GetReason() string`

GetReason returns the Reason field if non-nil, zero value otherwise.

### GetReasonOk

`func (o *CreateAccessRuleRequest) GetReasonOk() (*string, bool)`

GetReasonOk returns a tuple with the Reason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReason

`func (o *CreateAccessRuleRequest) SetReason(v string)`

SetReason sets Reason field to given value.

### HasReason

`func (o *CreateAccessRuleRequest) HasReason() bool`

HasReason returns a boolean if a field has been set.

### GetExpiresAt

`func (o *CreateAccessRuleRequest) GetExpiresAt() time.Time`

GetExpiresAt returns the ExpiresAt field if non-nil, zero value otherwise.

### GetExpiresAtOk

`func (o *CreateAccessRuleRequest) GetExpiresAtOk() (*time.Time, bool)`

GetExpiresAtOk returns a tuple with the ExpiresAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpiresAt

`func (o *CreateAccessRuleRequest) SetExpiresAt(v time.Time)`

SetExpiresAt sets ExpiresAt field to given value.

### HasExpiresAt

`func (o *CreateAccessRuleRequest) HasExpiresAt() bool`

HasExpiresAt returns a boolean if a field has been set.

### GetAction

`func (o *CreateAccessRuleRequest) GetAction() string`

GetAction returns the Action field if non-nil, zero value otherwise.

### GetActionOk

`func (o *CreateAccessRuleRequest) GetActionOk() (*string, bool)`

GetActionOk returns a tuple with the Action field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAction

`func (o *CreateAccessRuleRequest) SetAction(v string)`

SetAction sets Action field to given value.

### HasAction

`func (o *CreateAccessRuleRequest) HasAction() bool`

HasAction returns a boolean if a field has been set.

### GetBlockMessage

`func (o *CreateAccessRuleRequest) GetBlockMessage() string`

GetBlockMessage returns the BlockMessage field if non-nil, zero value otherwise.

### GetBlockMessageOk

`func (o *CreateAccessRuleRequest) GetBlockMessageOk() (*string, bool)`

GetBlockMessageOk returns a tuple with the BlockMessage field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBlockMessage

`func (o *CreateAccessRuleRequest) SetBlockMessage(v string)`

SetBlockMessage sets BlockMessage field to given value.

### HasBlockMessage

`func (o *CreateAccessRuleRequest) HasBlockMessage() bool`

HasBlockMessage returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


