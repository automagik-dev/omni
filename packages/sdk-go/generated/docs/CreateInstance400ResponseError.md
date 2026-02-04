# CreateInstance400ResponseError

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Code** | **string** | Error code | 
**Message** | **string** | Human-readable error message | 
**Details** | Pointer to **interface{}** | Additional error details | [optional] 

## Methods

### NewCreateInstance400ResponseError

`func NewCreateInstance400ResponseError(code string, message string, ) *CreateInstance400ResponseError`

NewCreateInstance400ResponseError instantiates a new CreateInstance400ResponseError object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewCreateInstance400ResponseErrorWithDefaults

`func NewCreateInstance400ResponseErrorWithDefaults() *CreateInstance400ResponseError`

NewCreateInstance400ResponseErrorWithDefaults instantiates a new CreateInstance400ResponseError object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetCode

`func (o *CreateInstance400ResponseError) GetCode() string`

GetCode returns the Code field if non-nil, zero value otherwise.

### GetCodeOk

`func (o *CreateInstance400ResponseError) GetCodeOk() (*string, bool)`

GetCodeOk returns a tuple with the Code field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCode

`func (o *CreateInstance400ResponseError) SetCode(v string)`

SetCode sets Code field to given value.


### GetMessage

`func (o *CreateInstance400ResponseError) GetMessage() string`

GetMessage returns the Message field if non-nil, zero value otherwise.

### GetMessageOk

`func (o *CreateInstance400ResponseError) GetMessageOk() (*string, bool)`

GetMessageOk returns a tuple with the Message field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessage

`func (o *CreateInstance400ResponseError) SetMessage(v string)`

SetMessage sets Message field to given value.


### GetDetails

`func (o *CreateInstance400ResponseError) GetDetails() interface{}`

GetDetails returns the Details field if non-nil, zero value otherwise.

### GetDetailsOk

`func (o *CreateInstance400ResponseError) GetDetailsOk() (*interface{}, bool)`

GetDetailsOk returns a tuple with the Details field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDetails

`func (o *CreateInstance400ResponseError) SetDetails(v interface{})`

SetDetails sets Details field to given value.

### HasDetails

`func (o *CreateInstance400ResponseError) HasDetails() bool`

HasDetails returns a boolean if a field has been set.

### SetDetailsNil

`func (o *CreateInstance400ResponseError) SetDetailsNil(b bool)`

 SetDetailsNil sets the value for Details to be an explicit nil

### UnsetDetails
`func (o *CreateInstance400ResponseError) UnsetDetails()`

UnsetDetails ensures that no value is present for Details, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


