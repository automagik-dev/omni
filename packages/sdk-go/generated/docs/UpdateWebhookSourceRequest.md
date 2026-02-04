# UpdateWebhookSourceRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | Pointer to **string** | Unique source name | [optional] 
**Description** | Pointer to **string** | Description | [optional] 
**ExpectedHeaders** | Pointer to **map[string]bool** | Headers to validate | [optional] 
**Enabled** | Pointer to **bool** | Whether enabled | [optional] [default to true]

## Methods

### NewUpdateWebhookSourceRequest

`func NewUpdateWebhookSourceRequest() *UpdateWebhookSourceRequest`

NewUpdateWebhookSourceRequest instantiates a new UpdateWebhookSourceRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewUpdateWebhookSourceRequestWithDefaults

`func NewUpdateWebhookSourceRequestWithDefaults() *UpdateWebhookSourceRequest`

NewUpdateWebhookSourceRequestWithDefaults instantiates a new UpdateWebhookSourceRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *UpdateWebhookSourceRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *UpdateWebhookSourceRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *UpdateWebhookSourceRequest) SetName(v string)`

SetName sets Name field to given value.

### HasName

`func (o *UpdateWebhookSourceRequest) HasName() bool`

HasName returns a boolean if a field has been set.

### GetDescription

`func (o *UpdateWebhookSourceRequest) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *UpdateWebhookSourceRequest) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *UpdateWebhookSourceRequest) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *UpdateWebhookSourceRequest) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetExpectedHeaders

`func (o *UpdateWebhookSourceRequest) GetExpectedHeaders() map[string]bool`

GetExpectedHeaders returns the ExpectedHeaders field if non-nil, zero value otherwise.

### GetExpectedHeadersOk

`func (o *UpdateWebhookSourceRequest) GetExpectedHeadersOk() (*map[string]bool, bool)`

GetExpectedHeadersOk returns a tuple with the ExpectedHeaders field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpectedHeaders

`func (o *UpdateWebhookSourceRequest) SetExpectedHeaders(v map[string]bool)`

SetExpectedHeaders sets ExpectedHeaders field to given value.

### HasExpectedHeaders

`func (o *UpdateWebhookSourceRequest) HasExpectedHeaders() bool`

HasExpectedHeaders returns a boolean if a field has been set.

### GetEnabled

`func (o *UpdateWebhookSourceRequest) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *UpdateWebhookSourceRequest) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *UpdateWebhookSourceRequest) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.

### HasEnabled

`func (o *UpdateWebhookSourceRequest) HasEnabled() bool`

HasEnabled returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


