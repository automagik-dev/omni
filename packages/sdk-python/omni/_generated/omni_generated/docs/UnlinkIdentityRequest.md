# UnlinkIdentityRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**identity_id** | **UUID** | Identity ID to unlink | 
**reason** | **str** | Reason for unlinking | 

## Example

```python
from omni_generated.models.unlink_identity_request import UnlinkIdentityRequest

# TODO update the JSON string below
json = "{}"
# create an instance of UnlinkIdentityRequest from a JSON string
unlink_identity_request_instance = UnlinkIdentityRequest.from_json(json)
# print the JSON string representation of the object
print(UnlinkIdentityRequest.to_json())

# convert the object into a dict
unlink_identity_request_dict = unlink_identity_request_instance.to_dict()
# create an instance of UnlinkIdentityRequest from a dict
unlink_identity_request_from_dict = UnlinkIdentityRequest.from_dict(unlink_identity_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


