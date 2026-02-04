# CheckAccess200ResponseData

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Allowed** | **bool** | Whether access is allowed | 
**Rule** | [**NullableCheckAccess200ResponseDataRule**](CheckAccess200ResponseDataRule.md) |  | 
**Reason** | **NullableString** | Reason for decision | 

## Methods

### NewCheckAccess200ResponseData

`func NewCheckAccess200ResponseData(allowed bool, rule NullableCheckAccess200ResponseDataRule, reason NullableString, ) *CheckAccess200ResponseData`

NewCheckAccess200ResponseData instantiates a new CheckAccess200ResponseData object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewCheckAccess200ResponseDataWithDefaults

`func NewCheckAccess200ResponseDataWithDefaults() *CheckAccess200ResponseData`

NewCheckAccess200ResponseDataWithDefaults instantiates a new CheckAccess200ResponseData object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetAllowed

`func (o *CheckAccess200ResponseData) GetAllowed() bool`

GetAllowed returns the Allowed field if non-nil, zero value otherwise.

### GetAllowedOk

`func (o *CheckAccess200ResponseData) GetAllowedOk() (*bool, bool)`

GetAllowedOk returns a tuple with the Allowed field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAllowed

`func (o *CheckAccess200ResponseData) SetAllowed(v bool)`

SetAllowed sets Allowed field to given value.


### GetRule

`func (o *CheckAccess200ResponseData) GetRule() CheckAccess200ResponseDataRule`

GetRule returns the Rule field if non-nil, zero value otherwise.

### GetRuleOk

`func (o *CheckAccess200ResponseData) GetRuleOk() (*CheckAccess200ResponseDataRule, bool)`

GetRuleOk returns a tuple with the Rule field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRule

`func (o *CheckAccess200ResponseData) SetRule(v CheckAccess200ResponseDataRule)`

SetRule sets Rule field to given value.


### SetRuleNil

`func (o *CheckAccess200ResponseData) SetRuleNil(b bool)`

 SetRuleNil sets the value for Rule to be an explicit nil

### UnsetRule
`func (o *CheckAccess200ResponseData) UnsetRule()`

UnsetRule ensures that no value is present for Rule, not even an explicit nil
### GetReason

`func (o *CheckAccess200ResponseData) GetReason() string`

GetReason returns the Reason field if non-nil, zero value otherwise.

### GetReasonOk

`func (o *CheckAccess200ResponseData) GetReasonOk() (*string, bool)`

GetReasonOk returns a tuple with the Reason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReason

`func (o *CheckAccess200ResponseData) SetReason(v string)`

SetReason sets Reason field to given value.


### SetReasonNil

`func (o *CheckAccess200ResponseData) SetReasonNil(b bool)`

 SetReasonNil sets the value for Reason to be an explicit nil

### UnsetReason
`func (o *CheckAccess200ResponseData) UnsetReason()`

UnsetReason ensures that no value is present for Reason, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


