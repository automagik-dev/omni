# WebhookSource

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Source UUID | 
**Name** | **string** | Source name | 
**Description** | **NullableString** | Description | 
**ExpectedHeaders** | **map[string]bool** | Expected headers | 
**Enabled** | **bool** | Whether enabled | 
**CreatedAt** | **time.Time** | Creation timestamp | 
**UpdatedAt** | **time.Time** | Last update timestamp | 

## Methods

### NewWebhookSource

`func NewWebhookSource(id string, name string, description NullableString, expectedHeaders map[string]bool, enabled bool, createdAt time.Time, updatedAt time.Time, ) *WebhookSource`

NewWebhookSource instantiates a new WebhookSource object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewWebhookSourceWithDefaults

`func NewWebhookSourceWithDefaults() *WebhookSource`

NewWebhookSourceWithDefaults instantiates a new WebhookSource object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *WebhookSource) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *WebhookSource) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *WebhookSource) SetId(v string)`

SetId sets Id field to given value.


### GetName

`func (o *WebhookSource) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *WebhookSource) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *WebhookSource) SetName(v string)`

SetName sets Name field to given value.


### GetDescription

`func (o *WebhookSource) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *WebhookSource) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *WebhookSource) SetDescription(v string)`

SetDescription sets Description field to given value.


### SetDescriptionNil

`func (o *WebhookSource) SetDescriptionNil(b bool)`

 SetDescriptionNil sets the value for Description to be an explicit nil

### UnsetDescription
`func (o *WebhookSource) UnsetDescription()`

UnsetDescription ensures that no value is present for Description, not even an explicit nil
### GetExpectedHeaders

`func (o *WebhookSource) GetExpectedHeaders() map[string]bool`

GetExpectedHeaders returns the ExpectedHeaders field if non-nil, zero value otherwise.

### GetExpectedHeadersOk

`func (o *WebhookSource) GetExpectedHeadersOk() (*map[string]bool, bool)`

GetExpectedHeadersOk returns a tuple with the ExpectedHeaders field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpectedHeaders

`func (o *WebhookSource) SetExpectedHeaders(v map[string]bool)`

SetExpectedHeaders sets ExpectedHeaders field to given value.


### SetExpectedHeadersNil

`func (o *WebhookSource) SetExpectedHeadersNil(b bool)`

 SetExpectedHeadersNil sets the value for ExpectedHeaders to be an explicit nil

### UnsetExpectedHeaders
`func (o *WebhookSource) UnsetExpectedHeaders()`

UnsetExpectedHeaders ensures that no value is present for ExpectedHeaders, not even an explicit nil
### GetEnabled

`func (o *WebhookSource) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *WebhookSource) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *WebhookSource) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.


### GetCreatedAt

`func (o *WebhookSource) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *WebhookSource) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *WebhookSource) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.


### GetUpdatedAt

`func (o *WebhookSource) GetUpdatedAt() time.Time`

GetUpdatedAt returns the UpdatedAt field if non-nil, zero value otherwise.

### GetUpdatedAtOk

`func (o *WebhookSource) GetUpdatedAtOk() (*time.Time, bool)`

GetUpdatedAtOk returns a tuple with the UpdatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUpdatedAt

`func (o *WebhookSource) SetUpdatedAt(v time.Time)`

SetUpdatedAt sets UpdatedAt field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


